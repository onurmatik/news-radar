import json
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings

from newsradar.contents.models import Content
from newsradar.executions.models import Execution
from newsradar.executions.services import execute_web_search
from newsradar.topics.models import Topic, TopicGroup


class _FakeSearchResponse:
    def __init__(self, payload: dict | None = None):
        self._payload = payload or {"results": []}

    def model_dump(self):
        return self._payload


class _FakePerplexityClient:
    def __init__(self, payloads: list[dict], response_payload: dict | None = None):
        self._payloads = payloads
        self._response_payload = response_payload or {"results": []}
        self.search = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self._payloads.append(kwargs)
        return _FakeSearchResponse(self._response_payload)


@override_settings(
    OPENAI_API_KEY="test-openai-key",
    OPENAI_RESPONSES_MODEL="gpt-4.1-mini",
    OPENAI_RESPONSES_TIMEOUT_SECONDS=5,
)
class ExecuteWebSearchAdditionalQueriesModeTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="exec-user",
            email="exec-user@example.com",
            password="password123",
        )

    def _create_topic(
        self,
        queries: list[str],
        mode: str,
        *,
        group: TopicGroup | None = None,
        update_frequency: str = "manual",
    ) -> Topic:
        with patch("newsradar.topics.models.OpenAI") as openai_cls:
            openai_cls.return_value.embeddings.create.return_value = SimpleNamespace(
                data=[SimpleNamespace(embedding=[0.0] * 1536)]
            )
            return Topic.objects.create(
                user=self.user,
                group=group,
                queries=queries,
                additional_queries_mode=mode,
                update_frequency=update_frequency,
            )

    def test_manual_mode_uses_saved_query_list(self):
        topic = self._create_topic(
            queries=["battery recycling", "lithium supply"],
            mode=Topic.ADDITIONAL_QUERIES_MODE_MANUAL,
        )
        captured_payloads: list[dict] = []
        with patch(
            "newsradar.executions.services.Perplexity",
            return_value=_FakePerplexityClient(captured_payloads),
        ):
            execute_web_search(str(topic.uuid))

        self.assertEqual(len(captured_payloads), 1)
        self.assertEqual(
            captured_payloads[0]["query"],
            ["battery recycling", "lithium supply"],
        )

    def test_auto_mode_generates_additional_queries(self):
        topic = self._create_topic(
            queries=["battery recycling"],
            mode=Topic.ADDITIONAL_QUERIES_MODE_AUTO,
        )
        captured_payloads: list[dict] = []

        with patch(
            "newsradar.executions.services.Perplexity",
            return_value=_FakePerplexityClient(captured_payloads),
        ):
            with patch("newsradar.executions.services.OpenAI") as openai_cls:
                openai_cls.return_value.responses.create.return_value = SimpleNamespace(
                    output_text='{"queries":["lithium permitting policy","battery scrap processors","battery recycling"]}'
                )
                execute_web_search(str(topic.uuid))

        self.assertEqual(len(captured_payloads), 1)
        self.assertEqual(
            captured_payloads[0]["query"],
            [
                "battery recycling",
                "lithium permitting policy",
                "battery scrap processors",
            ],
        )

    @override_settings(OPENAI_RESPONSES_REASONING_EFFORT="medium")
    def test_auto_mode_passes_reasoning_effort_when_configured(self):
        topic = self._create_topic(
            queries=["battery recycling"],
            mode=Topic.ADDITIONAL_QUERIES_MODE_AUTO,
        )
        captured_payloads: list[dict] = []

        with patch(
            "newsradar.executions.services.Perplexity",
            return_value=_FakePerplexityClient(captured_payloads),
        ):
            with patch("newsradar.executions.services.OpenAI") as openai_cls:
                openai_cls.return_value.responses.create.return_value = SimpleNamespace(
                    output_text='{"queries":["lithium permitting policy"]}'
                )
                execute_web_search(str(topic.uuid))

        call_kwargs = openai_cls.return_value.responses.create.call_args.kwargs
        self.assertEqual(call_kwargs["reasoning"], {"effort": "medium"})

    def test_does_not_queue_realtime_email_when_new_content_is_created(self):
        topic = self._create_topic(
            queries=["battery recycling"],
            mode=Topic.ADDITIONAL_QUERIES_MODE_MANUAL,
        )
        captured_payloads: list[dict] = []
        response_payload = {
            "results": [
                {
                    "url": "https://example.com/new-story",
                    "title": "Battery recycling policy update",
                    "last_updated": "2026-02-12T10:00:00Z",
                }
            ]
        }

        with patch(
            "newsradar.executions.services.Perplexity",
            return_value=_FakePerplexityClient(captured_payloads, response_payload),
        ):
            with patch(
                "newsradar.contents.tasks.send_new_items_email_notification.delay"
            ) as delay_mock:
                result = execute_web_search(str(topic.uuid))

        self.assertEqual(len(captured_payloads), 1)
        self.assertIsNotNone(result["content_item_id"])
        delay_mock.assert_not_called()

    def test_does_not_queue_realtime_email_when_no_new_content_is_created(self):
        topic = self._create_topic(
            queries=["battery recycling"],
            mode=Topic.ADDITIONAL_QUERIES_MODE_MANUAL,
        )
        existing_execution = Execution.objects.create(
            topic=topic,
            initiator=Execution.Initiator.USER,
            status=Execution.Status.COMPLETED,
        )
        Content.objects.create(
            execution=existing_execution,
            topic=topic,
            url="https://example.com/existing-story",
            title="Existing story",
        )

        captured_payloads: list[dict] = []
        response_payload = {
            "results": [
                {
                    "url": "https://example.com/existing-story",
                    "title": "Existing story",
                }
            ]
        }

        with patch(
            "newsradar.executions.services.Perplexity",
            return_value=_FakePerplexityClient(captured_payloads, response_payload),
        ):
            with patch(
                "newsradar.contents.tasks.send_new_items_email_notification.delay"
            ) as delay_mock:
                result = execute_web_search(str(topic.uuid))

        self.assertEqual(len(captured_payloads), 1)
        self.assertIsNone(result["content_item_id"])
        delay_mock.assert_not_called()

    def test_execute_web_search_rejects_paused_topic_group(self):
        group = TopicGroup.objects.create(
            user=self.user,
            name="Paused group",
            is_paused=True,
        )
        topic = self._create_topic(
            queries=["battery recycling"],
            mode=Topic.ADDITIONAL_QUERIES_MODE_MANUAL,
            group=group,
        )

        with patch("newsradar.executions.services.Perplexity") as perplexity_cls:
            with self.assertRaisesMessage(
                ValueError,
                'Scanning is paused for topic group "Paused group".',
            ):
                execute_web_search(str(topic.uuid))

        perplexity_cls.assert_not_called()

    def test_execute_web_search_marks_existing_execution_failed_when_group_is_paused(self):
        group = TopicGroup.objects.create(
            user=self.user,
            name="Paused group",
            is_paused=True,
        )
        topic = self._create_topic(
            queries=["battery recycling"],
            mode=Topic.ADDITIONAL_QUERIES_MODE_MANUAL,
            group=group,
        )
        execution = Execution.objects.create(
            topic=topic,
            initiator=Execution.Initiator.USER,
            status=Execution.Status.CREATED,
        )

        with self.assertRaisesMessage(
            ValueError,
            'Scanning is paused for topic group "Paused group".',
        ):
            execute_web_search(str(topic.uuid), execution_id=execution.id)

        execution.refresh_from_db()
        self.assertEqual(execution.status, Execution.Status.FAILED)
        self.assertEqual(
            execution.error_message,
            'Scanning is paused for topic group "Paused group".',
        )


class ExecutionPauseApiTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="exec-api-user",
            email="exec-api-user@example.com",
            password="password123",
        )

    def _create_topic(
        self,
        *,
        query: str,
        update_frequency: str = "manual",
        group: TopicGroup | None = None,
    ) -> Topic:
        with patch("newsradar.topics.models.OpenAI") as openai_cls:
            openai_cls.return_value.embeddings.create.return_value = SimpleNamespace(
                data=[SimpleNamespace(embedding=[0.0] * 1536)]
            )
            return Topic.objects.create(
                user=self.user,
                group=group,
                queries=[query],
                update_frequency=update_frequency,
                additional_queries_mode=Topic.ADDITIONAL_QUERIES_MODE_MANUAL,
            )

    def test_web_search_api_rejects_paused_topic_group(self):
        group = TopicGroup.objects.create(
            user=self.user,
            name="Paused group",
            is_paused=True,
        )
        topic = self._create_topic(query="battery recycling", group=group)
        self.client.force_login(self.user)

        response = self.client.post(
            "/api/executions/web-search/",
            data=json.dumps(
                {
                    "topic_uuid": str(topic.uuid),
                    "initiator": "user",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.json()["detail"],
            'Scanning is paused for topic group "Paused group".',
        )
        self.assertFalse(Execution.objects.exists())

    def test_scheduled_execution_command_skips_paused_groups(self):
        active_group = TopicGroup.objects.create(
            user=self.user,
            name="Active group",
            is_paused=False,
        )
        paused_group = TopicGroup.objects.create(
            user=self.user,
            name="Paused group",
            is_paused=True,
        )
        active_group_topic = self._create_topic(
            query="active group topic",
            update_frequency="day",
            group=active_group,
        )
        self._create_topic(
            query="paused group topic",
            update_frequency="day",
            group=paused_group,
        )
        groupless_topic = self._create_topic(
            query="groupless topic",
            update_frequency="day",
        )

        with patch(
            "newsradar.executions.management.commands.scheduled_web_search_execution.web_search_execution.delay"
        ) as delay_mock:
            call_command("scheduled_web_search_execution")

        queued_topic_uuids = {call.args[0] for call in delay_mock.call_args_list}
        self.assertEqual(
            queued_topic_uuids,
            {str(active_group_topic.uuid), str(groupless_topic.uuid)},
        )
