import json
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from newsradar.contents.models import AIInteraction, Bookmark, Content
from newsradar.executions.models import Execution
from newsradar.topics.models import Topic, TopicGroup


@override_settings(
    OPENAI_API_KEY="test-openai-key",
    OPENAI_RESPONSES_MODEL="gpt-4.1-mini",
    OPENAI_RESPONSES_TIMEOUT_SECONDS=5,
    OPENAI_RESPONSES_MAX_CONTENT_ITEMS=20,
    OPENAI_RESPONSES_MAX_INSTRUCTION_CHARS=4000,
    OPENAI_RESPONSES_MAX_OUTPUT_TOKENS=512,
)
class ContentAIEndpointTests(TestCase):
    endpoint = "/api/contents/ai/respond"

    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="user",
            email="user@example.com",
            password="password123",
        )
        self.other_user = user_model.objects.create_user(
            username="other",
            email="other@example.com",
            password="password123",
        )
        self.content = self._create_content_for_user(
            self.user,
            "https://example.com/news-1",
            "Main title",
        )
        self.other_user_content = self._create_content_for_user(
            self.other_user,
            "https://example.com/news-2",
            "Other title",
        )

    def _create_topic_for_user(self, user, query: str) -> Topic:
        with patch("newsradar.topics.models.OpenAI") as openai_cls:
            openai_cls.return_value.embeddings.create.return_value = SimpleNamespace(
                data=[SimpleNamespace(embedding=[0.0] * 1536)]
            )
            return Topic.objects.create(
                user=user,
                queries=[query],
                update_frequency="manual",
            )

    def _create_content_for_user(self, user, url: str, title: str) -> Content:
        topic = self._create_topic_for_user(user, query=title)
        execution = Execution.objects.create(
            topic=topic,
            initiator=Execution.Initiator.USER,
            status=Execution.Status.COMPLETED,
        )
        return Content.objects.create(
            execution=execution,
            topic=topic,
            url=url,
            title=title,
            snippet=f"{title} snippet",
        )

    def _post(self, payload: dict):
        return self.client.post(
            self.endpoint,
            data=json.dumps(payload),
            content_type="application/json",
        )

    def test_requires_authentication(self):
        response = self._post(
            {
                "content_ids": [self.content.id],
                "instruction": "Summarize this.",
            }
        )

        self.assertEqual(response.status_code, 401)

    def test_returns_404_for_unowned_content(self):
        self.client.force_login(self.user)
        response = self._post(
            {
                "content_ids": [self.other_user_content.id],
                "instruction": "Summarize this.",
            }
        )

        self.assertEqual(response.status_code, 404)

    def test_returns_ai_response_text(self):
        self.client.force_login(self.user)

        with patch("newsradar.contents.api.OpenAI") as openai_cls:
            openai_cls.return_value.responses.create.return_value = SimpleNamespace(
                id="resp_123",
                model="gpt-4.1-mini",
                output_text="Here is the summary.",
                usage=SimpleNamespace(
                    input_tokens=12,
                    output_tokens=8,
                    total_tokens=20,
                ),
            )
            response = self._post(
                {
                    "content_ids": [self.content.id],
                    "instruction": "Summarize this news item.",
                }
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["answer"], "Here is the summary.")
        self.assertEqual(body["model"], "gpt-4.1-mini")
        self.assertEqual(body["response_id"], "resp_123")
        self.assertEqual(body["content_count"], 1)
        self.assertEqual(body["input_tokens"], 12)
        self.assertEqual(body["output_tokens"], 8)
        self.assertEqual(body["total_tokens"], 20)

        call_kwargs = openai_cls.return_value.responses.create.call_args.kwargs
        request_payload = json.loads(call_kwargs["input"])
        self.assertEqual(call_kwargs["model"], "gpt-4.1-mini")
        self.assertEqual(request_payload["instruction"], "Summarize this news item.")
        self.assertEqual(request_payload["news_context"][0]["id"], self.content.id)

        interaction = AIInteraction.objects.get(user=self.user)
        self.assertEqual(interaction.status, AIInteraction.Status.COMPLETED)
        self.assertEqual(interaction.instruction, "Summarize this news item.")
        self.assertEqual(interaction.context_content_ids, [self.content.id])
        self.assertEqual(interaction.response_text, "Here is the summary.")
        self.assertEqual(interaction.model_requested, "gpt-4.1-mini")
        self.assertEqual(interaction.model_used, "gpt-4.1-mini")
        self.assertEqual(interaction.input_tokens, 12)
        self.assertEqual(interaction.output_tokens, 8)
        self.assertEqual(interaction.total_tokens, 20)
        self.assertEqual(str(interaction.credits_used), "20.000000")

    def test_maps_rate_limit_to_429(self):
        self.client.force_login(self.user)

        class FakeRateLimitError(Exception):
            pass

        with patch("newsradar.contents.api.RateLimitError", FakeRateLimitError):
            with patch("newsradar.contents.api.OpenAI") as openai_cls:
                openai_cls.return_value.responses.create.side_effect = (
                    FakeRateLimitError("too many requests")
                )
                response = self._post(
                    {
                        "content_ids": [self.content.id],
                        "instruction": "Summarize this news item.",
                    }
                )

        self.assertEqual(response.status_code, 429)
        interaction = AIInteraction.objects.get(user=self.user)
        self.assertEqual(interaction.status, AIInteraction.Status.FAILED)
        self.assertEqual(interaction.error_message, "AI provider rate limit reached.")

    def test_returns_502_when_provider_response_is_empty(self):
        self.client.force_login(self.user)

        with patch("newsradar.contents.api.OpenAI") as openai_cls:
            openai_cls.return_value.responses.create.return_value = SimpleNamespace(
                id="resp_empty",
                model="gpt-4.1-mini",
                output_text="",
                output=[],
                usage=None,
            )
            response = self._post(
                {
                    "content_ids": [self.content.id],
                    "instruction": "Summarize this news item.",
                }
            )

        self.assertEqual(response.status_code, 502)
        interaction = AIInteraction.objects.get(user=self.user)
        self.assertEqual(interaction.status, AIInteraction.Status.FAILED)
        self.assertEqual(interaction.error_message, "AI provider returned an empty response.")


class ContentFeedVersioningTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="feed-user",
            email="feed-user@example.com",
            password="password123",
        )
        self.client.force_login(self.user)

    def _create_topic_for_user(
        self,
        user,
        query: str,
        group: TopicGroup | None = None,
    ) -> Topic:
        with patch("newsradar.topics.models.OpenAI") as openai_cls:
            openai_cls.return_value.embeddings.create.return_value = SimpleNamespace(
                data=[SimpleNamespace(embedding=[0.0] * 1536)]
            )
            return Topic.objects.create(
                user=user,
                group=group,
                queries=[query],
                update_frequency="manual",
            )

    def _create_content(
        self,
        topic: Topic,
        *,
        url: str,
        title: str,
        last_updated=None,
    ) -> Content:
        execution = Execution.objects.create(
            topic=topic,
            initiator=Execution.Initiator.USER,
            status=Execution.Status.COMPLETED,
        )
        return Content.objects.create(
            execution=execution,
            topic=topic,
            url=url,
            title=title,
            last_updated=last_updated,
            snippet=f"{title} snippet",
        )

    def test_list_content_returns_latest_revision_per_topic_url(self):
        topic = self._create_topic_for_user(self.user, query="energy markets")
        now = timezone.now()
        old_revision = self._create_content(
            topic,
            url="https://example.com/story",
            title="Story old",
            last_updated=now - timedelta(days=2),
        )
        latest_revision = self._create_content(
            topic,
            url="https://example.com/story",
            title="Story latest",
            last_updated=now - timedelta(days=1),
        )
        other_content = self._create_content(
            topic,
            url="https://example.com/another-story",
            title="Another story",
            last_updated=now - timedelta(hours=1),
        )

        response = self.client.get("/api/contents/")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        items = body["items"]
        returned_ids = {item["id"] for item in items}
        self.assertIn(latest_revision.id, returned_ids)
        self.assertIn(other_content.id, returned_ids)
        self.assertNotIn(old_revision.id, returned_ids)
        self.assertEqual(sum(1 for item in items if item["url"] == "https://example.com/story"), 1)

    def test_list_content_by_group_returns_latest_revision_per_topic_url(self):
        group = TopicGroup.objects.create(
            user=self.user,
            name="Macro",
        )
        topic = self._create_topic_for_user(
            self.user,
            query="macro economy",
            group=group,
        )
        now = timezone.now()
        old_revision = self._create_content(
            topic,
            url="https://example.com/group-story",
            title="Group story old",
            last_updated=now - timedelta(days=3),
        )
        latest_revision = self._create_content(
            topic,
            url="https://example.com/group-story",
            title="Group story latest",
            last_updated=now - timedelta(days=1),
        )

        response = self.client.get(f"/api/contents/groups/{group.uuid}")

        self.assertEqual(response.status_code, 200)
        items = response.json()["items"]
        returned_ids = {item["id"] for item in items}
        self.assertIn(latest_revision.id, returned_ids)
        self.assertNotIn(old_revision.id, returned_ids)

    def test_bookmark_state_is_derived_from_any_revision_and_delete_is_article_level(self):
        topic = self._create_topic_for_user(self.user, query="semiconductors")
        now = timezone.now()
        old_revision = self._create_content(
            topic,
            url="https://example.com/chips",
            title="Chips old",
            last_updated=now - timedelta(days=2),
        )
        latest_revision = self._create_content(
            topic,
            url="https://example.com/chips",
            title="Chips latest",
            last_updated=now - timedelta(hours=2),
        )
        Bookmark.objects.create(
            user=self.user,
            content=old_revision,
        )

        response = self.client.get("/api/contents/")
        self.assertEqual(response.status_code, 200)
        items = response.json()["items"]
        latest_item = next(item for item in items if item["url"] == "https://example.com/chips")
        self.assertEqual(latest_item["id"], latest_revision.id)
        self.assertTrue(latest_item["is_bookmarked"])

        delete_response = self.client.delete(f"/api/contents/bookmarks/{latest_revision.id}")
        self.assertEqual(delete_response.status_code, 200)
        self.assertFalse(
            Bookmark.objects.filter(
                user=self.user,
                content__topic=topic,
                content__url="https://example.com/chips",
            ).exists()
        )

        refreshed_response = self.client.get("/api/contents/")
        refreshed_items = refreshed_response.json()["items"]
        refreshed_item = next(
            item for item in refreshed_items if item["url"] == "https://example.com/chips"
        )
        self.assertFalse(refreshed_item["is_bookmarked"])

    def test_get_content_item_uses_article_level_bookmark_state(self):
        topic = self._create_topic_for_user(self.user, query="supply chain")
        old_revision = self._create_content(
            topic,
            url="https://example.com/logistics",
            title="Logistics old",
        )
        latest_revision = self._create_content(
            topic,
            url="https://example.com/logistics",
            title="Logistics latest",
        )
        Bookmark.objects.create(
            user=self.user,
            content=old_revision,
        )

        response = self.client.get(f"/api/contents/items/{latest_revision.id}")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["id"], latest_revision.id)
        self.assertTrue(body["is_bookmarked"])
