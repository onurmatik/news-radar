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

    @override_settings(OPENAI_RESPONSES_MAX_INPUT_TOKENS=200_000)
    def test_accepts_more_than_twenty_content_items(self):
        self.client.force_login(self.user)
        many_contents = [
            self._create_content_for_user(
                self.user,
                f"https://example.com/news-{index + 10}",
                f"Title {index + 10}",
            )
            for index in range(21)
        ]
        payload_ids = [content.id for content in many_contents]

        with patch("newsradar.contents.api.OpenAI") as openai_cls:
            openai_cls.return_value.responses.create.return_value = SimpleNamespace(
                id="resp_many",
                model="gpt-4.1-mini",
                output_text="Many-item summary.",
                usage=SimpleNamespace(
                    input_tokens=200,
                    output_tokens=30,
                    total_tokens=230,
                ),
            )
            response = self._post(
                {
                    "content_ids": payload_ids,
                    "instruction": "Summarize this selection.",
                }
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["content_count"], 21)
        request_payload = json.loads(
            openai_cls.return_value.responses.create.call_args.kwargs["input"]
        )
        self.assertEqual(len(request_payload["news_context"]), 21)

        interaction = AIInteraction.objects.get(user=self.user)
        self.assertEqual(interaction.context_content_ids, payload_ids)
        self.assertEqual(len(interaction.context_payload), 21)

    @override_settings(OPENAI_RESPONSES_MAX_INPUT_TOKENS=1_200)
    def test_trims_context_to_input_token_budget(self):
        self.client.force_login(self.user)
        contents = [
            self._create_content_for_user(
                self.user,
                f"https://example.com/trim-{index}",
                f"Trim {index}",
            )
            for index in range(5)
        ]
        for content in contents:
            content.snippet = ("important context " * 45).strip()
            content.save(update_fields=["snippet"])

        with patch("newsradar.contents.api.OpenAI") as openai_cls:
            openai_cls.return_value.responses.create.return_value = SimpleNamespace(
                id="resp_trim",
                model="gpt-4.1-mini",
                output_text="Trimmed summary.",
                usage=SimpleNamespace(
                    input_tokens=100,
                    output_tokens=20,
                    total_tokens=120,
                ),
            )
            response = self._post(
                {
                    "content_ids": [content.id for content in contents],
                    "instruction": "Summarize this selection.",
                }
            )

        self.assertEqual(response.status_code, 200)
        request_payload = json.loads(
            openai_cls.return_value.responses.create.call_args.kwargs["input"]
        )
        trimmed_context = request_payload["news_context"]
        self.assertGreater(len(trimmed_context), 0)
        self.assertLess(len(trimmed_context), len(contents))

        expected_ids = [item["id"] for item in trimmed_context]
        body = response.json()
        self.assertEqual(body["content_count"], len(trimmed_context))

        interaction = AIInteraction.objects.get(user=self.user)
        self.assertEqual(interaction.context_content_ids, expected_ids)
        self.assertEqual(len(interaction.context_payload), len(trimmed_context))

    @override_settings(OPENAI_RESPONSES_MAX_OUTPUT_TOKENS=None)
    def test_omits_max_output_tokens_when_unset(self):
        self.client.force_login(self.user)

        with patch("newsradar.contents.api.OpenAI") as openai_cls:
            openai_cls.return_value.responses.create.return_value = SimpleNamespace(
                id="resp_no_cap",
                model="gpt-4.1-mini",
                output_text="No cap summary.",
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
        call_kwargs = openai_cls.return_value.responses.create.call_args.kwargs
        self.assertNotIn("max_output_tokens", call_kwargs)
        self.assertNotIn("reasoning", call_kwargs)

    @override_settings(OPENAI_RESPONSES_REASONING_EFFORT="low")
    def test_includes_reasoning_effort_when_configured(self):
        self.client.force_login(self.user)

        with patch("newsradar.contents.api.OpenAI") as openai_cls:
            openai_cls.return_value.responses.create.return_value = SimpleNamespace(
                id="resp_reasoning",
                model="gpt-4.1-mini",
                output_text="Reasoned summary.",
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
        call_kwargs = openai_cls.return_value.responses.create.call_args.kwargs
        self.assertEqual(call_kwargs["reasoning"], {"effort": "low"})

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

    def test_list_content_search_filters_title_snippet_and_url(self):
        topic = self._create_topic_for_user(self.user, query="markets")
        title_match = self._create_content(
            topic,
            url="https://example.com/one",
            title="Merger update",
        )
        snippet_match = self._create_content(
            topic,
            url="https://example.com/two",
            title="Industry note",
        )
        snippet_match.snippet = "A deep dive into quarterly earnings."
        snippet_match.save(update_fields=["snippet"])
        url_match = self._create_content(
            topic,
            url="https://example.com/search-target",
            title="Daily roundup",
        )
        self._create_content(
            topic,
            url="https://example.com/four",
            title="Completely unrelated",
        )

        response = self.client.get("/api/contents/?search=EARNINGS")
        self.assertEqual(response.status_code, 200)
        items = response.json()["items"]
        returned_ids = {item["id"] for item in items}
        self.assertIn(snippet_match.id, returned_ids)
        self.assertNotIn(title_match.id, returned_ids)
        self.assertNotIn(url_match.id, returned_ids)

        response = self.client.get("/api/contents/?search=merge")
        self.assertEqual(response.status_code, 200)
        items = response.json()["items"]
        returned_ids = {item["id"] for item in items}
        self.assertIn(title_match.id, returned_ids)
        self.assertNotIn(snippet_match.id, returned_ids)
        self.assertNotIn(url_match.id, returned_ids)

        response = self.client.get("/api/contents/?search=target")
        self.assertEqual(response.status_code, 200)
        items = response.json()["items"]
        returned_ids = {item["id"] for item in items}
        self.assertIn(url_match.id, returned_ids)
        self.assertNotIn(title_match.id, returned_ids)
        self.assertNotIn(snippet_match.id, returned_ids)

    def test_list_content_by_topic_and_group_accept_search_filter(self):
        group = TopicGroup.objects.create(
            user=self.user,
            name="Rates",
        )
        topic = self._create_topic_for_user(
            self.user,
            query="interest rates",
            group=group,
        )
        topic_match = self._create_content(
            topic,
            url="https://example.com/rates-hit",
            title="Fed rates update",
        )
        topic_non_match = self._create_content(
            topic,
            url="https://example.com/rates-miss",
            title="Labor market update",
        )

        topic_response = self.client.get(f"/api/contents/topics/{topic.uuid}?search=fed")
        self.assertEqual(topic_response.status_code, 200)
        topic_ids = {item["id"] for item in topic_response.json()["items"]}
        self.assertIn(topic_match.id, topic_ids)
        self.assertNotIn(topic_non_match.id, topic_ids)

        group_response = self.client.get(f"/api/contents/groups/{group.uuid}?search=fed")
        self.assertEqual(group_response.status_code, 200)
        group_ids = {item["id"] for item in group_response.json()["items"]}
        self.assertIn(topic_match.id, group_ids)
        self.assertNotIn(topic_non_match.id, group_ids)

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

    def test_soft_delete_hides_article_from_feed_and_detail_and_clears_bookmarks(self):
        topic = self._create_topic_for_user(self.user, query="energy")
        now = timezone.now()
        old_revision = self._create_content(
            topic,
            url="https://example.com/deletable-story",
            title="Deletable old",
            last_updated=now - timedelta(days=2),
        )
        latest_revision = self._create_content(
            topic,
            url="https://example.com/deletable-story",
            title="Deletable latest",
            last_updated=now - timedelta(days=1),
        )
        keep_revision = self._create_content(
            topic,
            url="https://example.com/keep-story",
            title="Keep story",
            last_updated=now - timedelta(hours=2),
        )
        Bookmark.objects.create(
            user=self.user,
            content=old_revision,
        )

        delete_response = self.client.delete(f"/api/contents/items/{latest_revision.id}")
        self.assertEqual(delete_response.status_code, 200)
        payload = delete_response.json()
        self.assertTrue(payload["deleted"])
        self.assertEqual(payload["soft_deleted_count"], 2)

        self.assertEqual(
            Content.objects.filter(
                topic=topic,
                url="https://example.com/deletable-story",
                deleted_at__isnull=False,
            ).count(),
            2,
        )
        self.assertFalse(
            Bookmark.objects.filter(
                user=self.user,
                content__topic=topic,
                content__url="https://example.com/deletable-story",
            ).exists()
        )

        feed_response = self.client.get("/api/contents/")
        self.assertEqual(feed_response.status_code, 200)
        returned_ids = {item["id"] for item in feed_response.json()["items"]}
        self.assertIn(keep_revision.id, returned_ids)
        self.assertNotIn(old_revision.id, returned_ids)
        self.assertNotIn(latest_revision.id, returned_ids)

        item_response = self.client.get(f"/api/contents/items/{latest_revision.id}")
        self.assertEqual(item_response.status_code, 404)
        detail_response = self.client.get(f"/api/contents/items/{latest_revision.id}/detail")
        self.assertEqual(detail_response.status_code, 404)

    def test_soft_delete_requires_authentication(self):
        topic = self._create_topic_for_user(self.user, query="rates")
        content = self._create_content(
            topic,
            url="https://example.com/rates",
            title="Rates",
        )

        self.client.logout()
        response = self.client.delete(f"/api/contents/items/{content.id}")
        self.assertEqual(response.status_code, 401)

    def test_soft_delete_requires_content_ownership(self):
        other_user = get_user_model().objects.create_user(
            username="someone-else",
            email="someone-else@example.com",
            password="password123",
        )
        other_topic = self._create_topic_for_user(other_user, query="oil")
        other_content = self._create_content(
            other_topic,
            url="https://example.com/oil",
            title="Oil",
        )

        response = self.client.delete(f"/api/contents/items/{other_content.id}")
        self.assertEqual(response.status_code, 404)

    def test_list_trash_and_restore_content_item(self):
        topic = self._create_topic_for_user(self.user, query="commodities")
        now = timezone.now()
        old_revision = self._create_content(
            topic,
            url="https://example.com/copper",
            title="Copper old",
            last_updated=now - timedelta(days=2),
        )
        latest_revision = self._create_content(
            topic,
            url="https://example.com/copper",
            title="Copper latest",
            last_updated=now - timedelta(days=1),
        )
        self._create_content(
            topic,
            url="https://example.com/nickel",
            title="Nickel",
            last_updated=now - timedelta(hours=1),
        )

        delete_response = self.client.delete(f"/api/contents/items/{latest_revision.id}")
        self.assertEqual(delete_response.status_code, 200)

        trash_response = self.client.get("/api/contents/trash")
        self.assertEqual(trash_response.status_code, 200)
        trash_items = trash_response.json()["items"]
        self.assertEqual(len(trash_items), 1)
        self.assertEqual(trash_items[0]["id"], latest_revision.id)
        self.assertEqual(trash_items[0]["url"], "https://example.com/copper")

        restore_response = self.client.post(f"/api/contents/items/{latest_revision.id}/restore")
        self.assertEqual(restore_response.status_code, 200)
        restore_payload = restore_response.json()
        self.assertTrue(restore_payload["restored"])
        self.assertEqual(restore_payload["restored_count"], 2)

        self.assertEqual(
            Content.objects.filter(
                topic=topic,
                url="https://example.com/copper",
                deleted_at__isnull=True,
            ).count(),
            2,
        )

        refreshed_feed_response = self.client.get("/api/contents/")
        self.assertEqual(refreshed_feed_response.status_code, 200)
        refreshed_items = refreshed_feed_response.json()["items"]
        restored_item = next(item for item in refreshed_items if item["url"] == "https://example.com/copper")
        self.assertEqual(restored_item["id"], latest_revision.id)

        self.assertFalse(
            Content.objects.filter(
                id=old_revision.id,
                deleted_at__isnull=False,
            ).exists()
        )

    def test_trash_and_restore_require_authentication(self):
        topic = self._create_topic_for_user(self.user, query="rates")
        content = self._create_content(
            topic,
            url="https://example.com/rates-2",
            title="Rates 2",
        )
        self.client.delete(f"/api/contents/items/{content.id}")

        self.client.logout()
        trash_response = self.client.get("/api/contents/trash")
        self.assertEqual(trash_response.status_code, 401)

        restore_response = self.client.post(f"/api/contents/items/{content.id}/restore")
        self.assertEqual(restore_response.status_code, 401)

        empty_response = self.client.delete("/api/contents/trash")
        self.assertEqual(empty_response.status_code, 401)

    def test_empty_trash_permanently_removes_deleted_items(self):
        topic = self._create_topic_for_user(self.user, query="metals")
        now = timezone.now()
        old_revision = self._create_content(
            topic,
            url="https://example.com/cobalt",
            title="Cobalt old",
            last_updated=now - timedelta(days=2),
        )
        latest_revision = self._create_content(
            topic,
            url="https://example.com/cobalt",
            title="Cobalt latest",
            last_updated=now - timedelta(days=1),
        )
        second_article = self._create_content(
            topic,
            url="https://example.com/lithium",
            title="Lithium",
            last_updated=now - timedelta(hours=4),
        )
        active_article = self._create_content(
            topic,
            url="https://example.com/nickel-active",
            title="Nickel active",
            last_updated=now - timedelta(hours=1),
        )

        self.client.delete(f"/api/contents/items/{latest_revision.id}")
        self.client.delete(f"/api/contents/items/{second_article.id}")

        empty_response = self.client.delete("/api/contents/trash")
        self.assertEqual(empty_response.status_code, 200)
        payload = empty_response.json()
        self.assertTrue(payload["deleted"])
        self.assertEqual(payload["permanently_deleted_count"], 3)

        self.assertFalse(
            Content.objects.filter(id__in=[old_revision.id, latest_revision.id, second_article.id]).exists()
        )
        self.assertTrue(Content.objects.filter(id=active_article.id).exists())

        trash_response = self.client.get("/api/contents/trash")
        self.assertEqual(trash_response.status_code, 200)
        self.assertEqual(trash_response.json()["items"], [])
