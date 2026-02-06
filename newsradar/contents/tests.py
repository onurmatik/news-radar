import json
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from newsradar.contents.models import AIInteraction, Content
from newsradar.executions.models import Execution
from newsradar.topics.models import Topic


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
