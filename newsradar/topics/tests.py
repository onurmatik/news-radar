import json
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from newsradar.topics.models import Topic, TopicGroup


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

    def test_create_topic_api_defaults_additional_queries_mode_to_auto(self):
        self.client.force_login(self.user)
        with self._mock_embeddings() as openai_cls:
            openai_cls.return_value.embeddings.create.return_value = SimpleNamespace(
                data=[SimpleNamespace(embedding=[0.0] * 1536)]
            )
            response = self.client.post(
                "/api/topics/",
                data=json.dumps(
                    {
                        "queries": ["climate adaptation", "urban resilience"],
                    }
                ),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["topic"]["additional_queries_mode"], "auto")
        self.assertEqual(body["topic"]["queries"], ["climate adaptation"])

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


class TopicShareApiTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="share-owner",
            email="share-owner@example.com",
            password="password123",
        )

    def _mock_embeddings(self):
        return patch("newsradar.topics.models.OpenAI")

    def _create_topic(
        self,
        *,
        group: TopicGroup | None = None,
        query: str = "shared radar topic",
    ) -> Topic:
        with self._mock_embeddings() as openai_cls:
            openai_cls.return_value.embeddings.create.return_value = SimpleNamespace(
                data=[SimpleNamespace(embedding=[0.0] * 1536)]
            )
            return Topic.objects.create(
                user=self.user,
                group=group,
                queries=[query],
                additional_queries_mode=Topic.ADDITIONAL_QUERIES_MODE_AUTO,
            )

    def test_shared_topic_endpoint_allows_anonymous_access(self):
        group = TopicGroup.objects.create(
            user=self.user,
            name="Private monitoring group",
            is_public=False,
        )
        topic = self._create_topic(group=group)

        self.client.logout()
        response = self.client.get(f"/api/topics/shared/topics/{topic.uuid}")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["uuid"], str(topic.uuid))
        self.assertEqual(body["group_uuid"], str(group.uuid))
        self.assertEqual(body["owner_username"], self.user.username)
        self.assertFalse(body["is_owner"])

    def test_shared_group_endpoint_allows_anonymous_access(self):
        group = TopicGroup.objects.create(
            user=self.user,
            name="Private strategy group",
            is_public=False,
        )

        self.client.logout()
        response = self.client.get(f"/api/topics/shared/groups/{group.uuid}")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["uuid"], str(group.uuid))
        self.assertEqual(body["name"], group.name)
        self.assertEqual(body["owner_username"], self.user.username)
        self.assertFalse(body["is_owner"])

    def test_shared_group_topics_endpoint_allows_anonymous_access(self):
        group = TopicGroup.objects.create(
            user=self.user,
            name="Private topic list group",
            is_public=False,
        )
        first_topic = self._create_topic(group=group, query="first shared topic")
        second_topic = self._create_topic(group=group, query="second shared topic")

        self.client.logout()
        response = self.client.get(f"/api/topics/shared/groups/{group.uuid}/topics")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        returned_uuids = {item["uuid"] for item in payload["topics"]}
        self.assertIn(str(first_topic.uuid), returned_uuids)
        self.assertIn(str(second_topic.uuid), returned_uuids)
