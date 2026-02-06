import json
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from newsradar.topics.models import Topic


class TopicAdditionalQueriesModeTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="topic-user",
            email="topic-user@example.com",
            password="password123",
        )

    def _mock_embeddings(self):
        return patch("newsradar.topics.models.OpenAI")

    def test_model_trims_additional_queries_in_auto_mode(self):
        with self._mock_embeddings() as openai_cls:
            openai_cls.return_value.embeddings.create.return_value = SimpleNamespace(
                data=[SimpleNamespace(embedding=[0.0] * 1536)]
            )
            topic = Topic.objects.create(
                user=self.user,
                queries=["electric vehicles", "ev battery supply chain"],
                additional_queries_mode=Topic.ADDITIONAL_QUERIES_MODE_AUTO,
            )

        self.assertEqual(topic.additional_queries_mode, Topic.ADDITIONAL_QUERIES_MODE_AUTO)
        self.assertEqual(topic.queries, ["electric vehicles"])

    def test_create_topic_api_accepts_additional_queries_mode(self):
        self.client.force_login(self.user)
        with self._mock_embeddings() as openai_cls:
            openai_cls.return_value.embeddings.create.return_value = SimpleNamespace(
                data=[SimpleNamespace(embedding=[0.0] * 1536)]
            )
            response = self.client.post(
                "/api/topics/",
                data=json.dumps(
                    {
                        "queries": ["semiconductor policy", "chip export controls"],
                        "additional_queries_mode": "auto",
                    }
                ),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["topic"]["additional_queries_mode"], "auto")
        self.assertEqual(body["topic"]["queries"], ["semiconductor policy"])

    def test_update_topic_api_switches_to_auto_and_trims_queries(self):
        with self._mock_embeddings() as openai_cls:
            openai_cls.return_value.embeddings.create.return_value = SimpleNamespace(
                data=[SimpleNamespace(embedding=[0.0] * 1536)]
            )
            topic = Topic.objects.create(
                user=self.user,
                queries=["energy transition", "grid modernization"],
                additional_queries_mode=Topic.ADDITIONAL_QUERIES_MODE_MANUAL,
            )

        self.client.force_login(self.user)
        with self._mock_embeddings() as openai_cls:
            openai_cls.return_value.embeddings.create.return_value = SimpleNamespace(
                data=[SimpleNamespace(embedding=[0.0] * 1536)]
            )
            response = self.client.patch(
                f"/api/topics/{topic.uuid}",
                data=json.dumps({"additional_queries_mode": "auto"}),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["additional_queries_mode"], "auto")
        self.assertEqual(body["queries"], ["energy transition"])
