from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from newsradar.executions.services import execute_web_search
from newsradar.topics.models import Topic


class _FakeSearchResponse:
    def model_dump(self):
        return {"results": []}


class _FakePerplexityClient:
    def __init__(self, payloads: list[dict]):
        self._payloads = payloads
        self.search = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self._payloads.append(kwargs)
        return _FakeSearchResponse()


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
    ) -> Topic:
        with patch("newsradar.topics.models.OpenAI") as openai_cls:
            openai_cls.return_value.embeddings.create.return_value = SimpleNamespace(
                data=[SimpleNamespace(embedding=[0.0] * 1536)]
            )
            return Topic.objects.create(
                user=self.user,
                queries=queries,
                additional_queries_mode=mode,
                update_frequency="manual",
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
