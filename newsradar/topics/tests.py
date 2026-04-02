import json
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from newsradar.topics.models import Topic, TopicGroup
from newsradar.topics.services import organize_topic_configuration


class TopicTestCase(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="topic-user",
            email="topic-user@example.com",
            password="password123",
        )

    def _mock_embeddings(self):
        return patch("newsradar.topics.models.OpenAI")


@override_settings(
    OPENAI_API_KEY="test-openai-key",
    OPENAI_RESPONSES_MODEL="gpt-4.1-mini",
    OPENAI_RESPONSES_TIMEOUT_SECONDS=5,
)
class TopicOrganizerServiceTests(TopicTestCase):
    def test_organizer_normalizes_openai_and_search_output(self):
        discovered_payload = {
            "results": [
                {
                    "url": "https://www.trade.gov/example",
                    "title": "Trade.gov example",
                    "snippet": "Official trade coverage.",
                },
                {
                    "url": "https://www.reuters.com/example",
                    "title": "Reuters example",
                    "snippet": "Major news coverage.",
                },
            ]
        }
        openai_response = {
            "display_title": "Turkey EV policy",
            "primary_query": "Turkey electric vehicle policy",
            "query_variations": [
                "Turkey EV incentives",
                "Turkey EV industrial policy",
                "Turkey electric vehicle policy",
            ],
            "source_suggestions": [
                {
                    "domain": "trade.gov",
                    "label": "Trade.gov",
                    "rationale": "Official U.S. trade reporting.",
                }
            ],
            "search_domain_allowlist": [],
            "country": "tr",
            "search_language_filter": ["TR", "en"],
            "update_frequency": "auto",
            "suggested_interval_hours": 6,
        }

        with patch("newsradar.topics.services.Perplexity") as perplexity_cls:
            perplexity_cls.return_value.search.create.return_value = SimpleNamespace(
                model_dump=lambda: discovered_payload
            )
            with patch("newsradar.topics.services.OpenAI") as openai_cls:
                openai_cls.return_value.responses.create.return_value = SimpleNamespace(
                    output_text=json.dumps(openai_response)
                )
                result = organize_topic_configuration("Türkiye EV policy")

        self.assertEqual(result["display_title"], "Turkey EV policy")
        self.assertEqual(result["primary_query"], "Turkey electric vehicle policy")
        self.assertEqual(
            result["query_variations"],
            ["Turkey EV incentives", "Turkey EV industrial policy"],
        )
        self.assertEqual(result["country"], "TR")
        self.assertEqual(result["search_language_filter"], ["tr", "en"])
        self.assertEqual(result["update_frequency"], Topic.UPDATE_FREQUENCY_AUTO)
        self.assertEqual(result["suggested_interval_hours"], 6)
        self.assertEqual(result["search_domain_allowlist"], ["trade.gov", "reuters.com"])

    @override_settings(OPENAI_API_KEY="")
    def test_organizer_falls_back_without_openai_key(self):
        with patch("newsradar.topics.services.Perplexity") as perplexity_cls:
            perplexity_cls.return_value.search.create.return_value = SimpleNamespace(
                model_dump=lambda: {
                    "results": [
                        {
                            "url": "https://www.resmigazete.gov.tr/example",
                            "title": "Resmi Gazete",
                            "snippet": "Official announcements.",
                        }
                    ]
                }
            )
            result = organize_topic_configuration("Türkiye gündemi")

        self.assertEqual(result["display_title"], "Türkiye gündemi")
        self.assertEqual(result["primary_query"], "Türkiye gündemi")
        self.assertEqual(result["country"], "TR")
        self.assertEqual(result["search_language_filter"], ["tr"])
        self.assertEqual(result["update_frequency"], Topic.UPDATE_FREQUENCY_AUTO)
        self.assertEqual(result["search_domain_allowlist"], ["resmigazete.gov.tr"])


class TopicApiTests(TopicTestCase):
    def setUp(self):
        super().setUp()
        self.client.force_login(self.user)

    def _create_topic(self) -> Topic:
        with self._mock_embeddings() as openai_cls:
            openai_cls.return_value.embeddings.create.return_value = SimpleNamespace(
                data=[SimpleNamespace(embedding=[0.0] * 1536)]
            )
            return Topic.objects.create(
                user=self.user,
                monitoring_prompt="battery recycling",
                display_title="Battery recycling",
                queries=["battery recycling", "battery recycling policy"],
                update_frequency=Topic.UPDATE_FREQUENCY_AUTO,
                auto_effective_interval_hours=6,
            )

    def test_create_topic_persists_reviewed_payload(self):
        with self._mock_embeddings() as openai_cls:
            openai_cls.return_value.embeddings.create.return_value = SimpleNamespace(
                data=[SimpleNamespace(embedding=[0.0] * 1536)]
            )
            response = self.client.post(
                "/api/topics/",
                data=json.dumps(
                    {
                        "monitoring_prompt": "Türkiye EV policy",
                        "display_title": "Turkey EV policy",
                        "primary_query": "Turkey electric vehicle policy",
                        "query_variations": [
                            "Turkey EV incentives",
                            "Turkey EV manufacturing",
                        ],
                        "search_domain_allowlist": ["trade.gov", "reuters.com"],
                        "search_language_filter": ["tr", "en"],
                        "country": "TR",
                        "update_frequency": "auto",
                        "auto_effective_interval_hours": 6,
                    }
                ),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()["topic"]
        self.assertEqual(payload["display_title"], "Turkey EV policy")
        self.assertEqual(
            payload["queries"],
            [
                "Turkey electric vehicle policy",
                "Turkey EV incentives",
                "Turkey EV manufacturing",
            ],
        )
        self.assertEqual(payload["update_frequency"], "auto")
        self.assertEqual(payload["auto_effective_interval_hours"], 6)

    def test_update_topic_replaces_fixed_queries(self):
        topic = self._create_topic()
        with self._mock_embeddings() as openai_cls:
            openai_cls.return_value.embeddings.create.return_value = SimpleNamespace(
                data=[SimpleNamespace(embedding=[0.0] * 1536)]
            )
            response = self.client.patch(
                f"/api/topics/{topic.uuid}",
                data=json.dumps(
                    {
                        "monitoring_prompt": "Grid reliability",
                        "display_title": "Grid reliability",
                        "primary_query": "grid reliability",
                        "query_variations": ["grid outage risk"],
                        "search_domain_allowlist": ["iea.org"],
                        "search_language_filter": ["en"],
                        "country": "US",
                        "update_frequency": "hour",
                        "auto_effective_interval_hours": 12,
                    }
                ),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["queries"], ["grid reliability", "grid outage risk"])
        self.assertEqual(payload["update_frequency"], "hour")
        self.assertIsNone(payload["auto_effective_interval_hours"])

    def test_organize_endpoint_passes_group_context(self):
        group = TopicGroup.objects.create(
            user=self.user,
            name="Policy",
            description="Industrial policy tracking",
        )
        with patch("newsradar.topics.api.organize_topic_configuration") as organize_mock:
            organize_mock.return_value = {
                "display_title": "EV policy",
                "primary_query": "electric vehicle policy",
                "query_variations": ["EV incentives"],
                "source_suggestions": [],
                "search_domain_allowlist": ["trade.gov"],
                "country": "US",
                "search_language_filter": ["en"],
                "update_frequency": "auto",
                "suggested_interval_hours": 6,
            }
            response = self.client.post(
                "/api/topics/organize",
                data=json.dumps(
                    {
                        "monitoring_prompt": "EV policy",
                        "group_uuid": str(group.uuid),
                    }
                ),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        organize_mock.assert_called_once_with(
            "EV policy",
            group_name="Policy",
            group_description="Industrial policy tracking",
        )
        self.assertEqual(response.json()["suggested_interval_hours"], 6)

    def test_group_create_update_delete_roundtrip(self):
        response = self.client.post(
            "/api/topics/groups",
            data=json.dumps({"name": "Signals", "description": "My group"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        group_uuid = response.json()["group"]["uuid"]

        update_response = self.client.patch(
            f"/api/topics/groups/{group_uuid}",
            data=json.dumps({"name": "Signals updated", "description": "Updated"}),
            content_type="application/json",
        )
        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.json()["name"], "Signals updated")

        delete_response = self.client.delete(f"/api/topics/groups/{group_uuid}")
        self.assertEqual(delete_response.status_code, 200)
        self.assertFalse(TopicGroup.objects.filter(uuid=group_uuid).exists())

    def test_group_list_endpoint_does_not_collide_with_topic_uuid_route(self):
        TopicGroup.objects.create(
            user=self.user,
            name="Signals",
            description="My group",
        )

        response = self.client.get("/api/topics/groups")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["groups"]), 1)
