from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from newsradar.executions.models import Execution
from newsradar.executions.services import execute_web_search, preview_web_search
from newsradar.topics.models import Topic


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


class ExecutionTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="exec-user",
            email="exec-user@example.com",
            password="password123",
        )

    def _create_topic(
        self,
        *,
        queries: list[str] | None = None,
        update_frequency: str = Topic.UPDATE_FREQUENCY_MANUAL,
        auto_interval: int | None = None,
        last_fetched_at=None,
    ) -> Topic:
        return Topic.objects.create(
            user=self.user,
            monitoring_prompt=(queries or ["battery recycling"])[0],
            display_title="Topic title",
            queries=queries or ["battery recycling"],
            update_frequency=update_frequency,
            auto_effective_interval_hours=auto_interval,
            last_fetched_at=last_fetched_at,
        )

    def test_saved_queries_are_passed_directly_to_search(self):
        topic = self._create_topic(queries=["battery recycling", "lithium supply"])
        captured_payloads: list[dict] = []
        with patch(
            "newsradar.executions.services.Perplexity",
            return_value=_FakePerplexityClient(captured_payloads),
        ):
            execute_web_search(str(topic.uuid))

        self.assertEqual(captured_payloads[0]["query"], ["battery recycling", "lithium supply"])

    def test_preview_search_uses_raw_queries_and_filters(self):
        captured_payloads: list[dict] = []
        with patch(
            "newsradar.executions.services.Perplexity",
            return_value=_FakePerplexityClient(
                captured_payloads,
                {
                    "results": [
                        {
                            "url": "https://www.reuters.com/example",
                            "title": "Story",
                            "snippet": "Summary",
                        }
                    ]
                },
            ),
        ):
            result = preview_web_search(
                queries=["battery recycling", "lithium supply"],
                search_domain_allowlist=["Reuters.com"],
                search_language_filter=["EN"],
                country="us",
            )

        self.assertEqual(captured_payloads[0]["query"], ["battery recycling", "lithium supply"])
        self.assertEqual(captured_payloads[0]["search_domain_filter"], ["reuters.com"])
        self.assertEqual(captured_payloads[0]["search_language_filter"], ["en"])
        self.assertEqual(captured_payloads[0]["country"], "US")
        self.assertEqual(result["items"][0]["domain"], "reuters.com")

    def test_auto_interval_halves_after_two_high_signal_runs(self):
        topic = self._create_topic(
            queries=["battery recycling"],
            update_frequency=Topic.UPDATE_FREQUENCY_AUTO,
            auto_interval=24,
        )

        with patch(
            "newsradar.executions.services.Perplexity",
            return_value=_FakePerplexityClient(
                [],
                {
                    "results": [
                        {"url": f"https://example.com/high-signal-{batch}-{index}", "title": "Story"}
                        for batch in range(2)
                        for index in range(3)
                    ][:3]
                },
            ),
        ):
            execute_web_search(str(topic.uuid))
        topic.refresh_from_db()
        self.assertEqual(topic.auto_effective_interval_hours, 24)

        with patch(
            "newsradar.executions.services.Perplexity",
            return_value=_FakePerplexityClient(
                [],
                {
                    "results": [
                        {"url": f"https://example.com/high-signal-second-{index}", "title": "Story"}
                        for index in range(3)
                    ]
                },
            ),
        ):
            execute_web_search(str(topic.uuid))

        topic.refresh_from_db()
        self.assertEqual(topic.auto_effective_interval_hours, 12)

    def test_auto_interval_doubles_after_three_empty_runs(self):
        topic = self._create_topic(
            queries=["macro policy"],
            update_frequency=Topic.UPDATE_FREQUENCY_AUTO,
            auto_interval=6,
        )

        for _ in range(3):
            with patch(
                "newsradar.executions.services.Perplexity",
                return_value=_FakePerplexityClient([], {"results": []}),
            ):
                execute_web_search(str(topic.uuid))

        topic.refresh_from_db()
        self.assertEqual(topic.auto_effective_interval_hours, 12)

    def test_web_search_api_creates_execution(self):
        topic = self._create_topic()
        self.client.force_login(self.user)
        with patch(
            "newsradar.executions.api.web_search_execution_task.delay",
            return_value=SimpleNamespace(id="task-123"),
        ):
            response = self.client.post(
                "/api/executions/web-search/",
                data='{"topic_uuid": "%s", "initiator": "user"}' % topic.uuid,
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["task_id"], "task-123")
        self.assertTrue(Execution.objects.filter(id=payload["execution_id"]).exists())

    def test_web_search_api_rejects_inactive_topic(self):
        topic = self._create_topic()
        topic.is_active = False
        topic.save(update_fields=["is_active"])
        self.client.force_login(self.user)

        response = self.client.post(
            "/api/executions/web-search/",
            data='{"topic_uuid": "%s", "initiator": "user"}' % topic.uuid,
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 404)
        self.assertFalse(Execution.objects.exists())

    def test_execute_web_search_rejects_inactive_topic(self):
        topic = self._create_topic()
        topic.is_active = False
        topic.save(update_fields=["is_active"])

        with self.assertRaisesMessage(ValueError, "Topic is inactive."):
            execute_web_search(str(topic.uuid))

    def test_scheduled_command_queues_due_fixed_and_auto_topics(self):
        now = timezone.now()
        due_hour = self._create_topic(
            queries=["hourly topic"],
            update_frequency=Topic.UPDATE_FREQUENCY_HOUR,
            last_fetched_at=now - timedelta(hours=2),
        )
        due_day = self._create_topic(
            queries=["daily topic"],
            update_frequency=Topic.UPDATE_FREQUENCY_DAY,
            last_fetched_at=now - timedelta(days=2),
        )
        due_week = self._create_topic(
            queries=["weekly topic"],
            update_frequency=Topic.UPDATE_FREQUENCY_WEEK,
            last_fetched_at=now - timedelta(days=8),
        )
        due_auto = self._create_topic(
            queries=["auto topic"],
            update_frequency=Topic.UPDATE_FREQUENCY_AUTO,
            auto_interval=6,
            last_fetched_at=now - timedelta(hours=7),
        )
        self._create_topic(
            queries=["manual topic"],
            update_frequency=Topic.UPDATE_FREQUENCY_MANUAL,
            last_fetched_at=now - timedelta(days=30),
        )
        self._create_topic(
            queries=["fresh auto topic"],
            update_frequency=Topic.UPDATE_FREQUENCY_AUTO,
            auto_interval=6,
            last_fetched_at=now - timedelta(hours=2),
        )
        inactive_collection_topic = self._create_topic(
            queries=["inactive collection topic"],
            update_frequency=Topic.UPDATE_FREQUENCY_HOUR,
            last_fetched_at=now - timedelta(hours=2),
        )
        inactive_collection_topic.group.is_active = False
        inactive_collection_topic.group.save(update_fields=["is_active", "updated_at"])
        inactive_topic = self._create_topic(
            queries=["inactive topic"],
            update_frequency=Topic.UPDATE_FREQUENCY_HOUR,
            last_fetched_at=now - timedelta(hours=2),
        )
        inactive_topic.is_active = False
        inactive_topic.save(update_fields=["is_active"])

        with patch(
            "newsradar.executions.management.commands.scheduled_web_search_execution.web_search_execution.delay"
        ) as delay_mock:
            call_command("scheduled_web_search_execution")

        queued_topic_uuids = {call.args[0] for call in delay_mock.call_args_list}
        self.assertEqual(
            queued_topic_uuids,
            {str(due_hour.uuid), str(due_day.uuid), str(due_week.uuid), str(due_auto.uuid)},
        )
