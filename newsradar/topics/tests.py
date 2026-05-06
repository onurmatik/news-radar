import json
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase, override_settings

from newsradar.topics.models import Topic, TopicGroup
from newsradar.topics.services import (
    normalize_domain_value,
    organize_topic_configuration,
    refine_topic_configuration,
    suggest_more_domains,
)


class TopicTestCase(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="topic-user",
            email="topic-user@example.com",
            password="password123",
        )


class TopicMandatoryCollectionsMigrationTests(TransactionTestCase):
    migrate_from = [("topics", "0002_purge_legacy_topic_schema")]
    migrate_to = [("topics", "0003_mandatory_collections")]

    def setUp(self):
        super().setUp()
        self.executor = MigrationExecutor(connection)
        self.executor.migrate(self.migrate_from)
        self.old_apps = self.executor.loader.project_state(self.migrate_from).apps

    def tearDown(self):
        self.executor.migrate(self.migrate_to)
        super().tearDown()

    def test_backfills_null_group_topics_with_unique_active_collections(self):
        user_model = self.old_apps.get_model("auth", "User")
        topic_model = self.old_apps.get_model("topics", "Topic")
        topic_group_model = self.old_apps.get_model("topics", "TopicGroup")
        user = user_model.objects.create_user(
            username="migration-user",
            email="migration-user@example.com",
            password="password123",
        )
        topic_group_model.objects.create(user=user, name="Signals", description="")
        topic_model.objects.create(
            user=user,
            monitoring_prompt="Signals",
            display_title="Signals",
            queries=["signals"],
            update_frequency="manual",
        )
        topic_model.objects.create(
            user=user,
            monitoring_prompt="Signals",
            display_title="Signals",
            queries=["signals duplicate"],
            update_frequency="manual",
        )
        topic_model.objects.create(
            user=user,
            monitoring_prompt="Unique",
            display_title="",
            queries=["unique query"],
            update_frequency="manual",
        )

        self.executor = MigrationExecutor(connection)
        self.executor.migrate(self.migrate_to)
        new_apps = self.executor.loader.project_state(self.migrate_to).apps
        migrated_topic_model = new_apps.get_model("topics", "Topic")
        migrated_group_model = new_apps.get_model("topics", "TopicGroup")

        self.assertFalse(migrated_topic_model.objects.filter(group__isnull=True).exists())
        self.assertEqual(
            set(migrated_group_model.objects.values_list("name", flat=True)),
            {"Signals", "Signals 2", "Signals 3", "unique query"},
        )
        self.assertTrue(
            all(migrated_group_model.objects.values_list("is_active", flat=True))
        )


@override_settings(
    OPENAI_API_KEY="test-openai-key",
    OPENAI_RESPONSES_MODEL="gpt-4.1-mini",
    OPENAI_RESPONSES_TIMEOUT_SECONDS=5,
)
class TopicOrganizerServiceTests(TopicTestCase):
    def test_organizer_normalizes_openai_output(self):
        openai_response = {
            "query_variations": [
                "Turkey electric vehicle policy",
                "Turkey EV incentives",
                "Turkey EV industrial policy",
                "Turkey electric vehicle policy",
            ],
            "domains": [
                "trade.gov",
                "https://www.reuters.com/world/turkey/",
                "international outlets like reuters or bbc in turkish",
            ],
            "country": "tr",
            "languages": ["TR", "en"],
            "topic_warning": "Topic is still broad. Consider narrowing it to EV incentives or industrial policy.",
            "suggested_group_name": "",
        }

        with patch("newsradar.topics.services.OpenAI") as openai_cls:
            openai_cls.return_value.responses.create.return_value = SimpleNamespace(
                output_text=json.dumps(openai_response)
            )
            result = organize_topic_configuration("Türkiye EV policy")

        prompt = openai_cls.return_value.responses.create.call_args.kwargs["input"]
        self.assertIn("one real website domain in hostname format", prompt)
        self.assertIn("Never return outlet names", prompt)
        self.assertEqual(result["display_title"], "Türkiye EV policy")
        self.assertEqual(
            result["query_variations"],
            [
                "Turkey electric vehicle policy",
                "Turkey EV incentives",
                "Turkey EV industrial policy",
            ],
        )
        self.assertEqual(result["suggested_domains"], ["trade.gov", "reuters.com"])
        self.assertEqual(result["country"], "TR")
        self.assertEqual(result["search_language_filter"], ["tr", "en"])
        self.assertEqual(
            result["topic_warning"],
            "Topic is still broad. Consider narrowing it to EV incentives or industrial policy.",
        )
        self.assertIsNone(result["suggested_group_name"])
        self.assertEqual(result["split_suggestions"], [])

    def test_organizer_drops_group_name_without_split_suggestions(self):
        openai_response = {
            "query_variations": [
                "politicization of judiciary in Turkey",
                "Turkey judicial independence politics",
            ],
            "domains": ["reuters.com"],
            "country": "tr",
            "languages": ["tr"],
            "topic_warning": "",
            "suggested_group_name": "Türkiye gündemi",
            "split_topics": [],
        }

        with patch("newsradar.topics.services.OpenAI") as openai_cls:
            openai_cls.return_value.responses.create.return_value = SimpleNamespace(
                output_text=json.dumps(openai_response)
            )
            result = organize_topic_configuration("Türkiye'de yargının siyasallaşması")

        prompt = openai_cls.return_value.responses.create.call_args.kwargs["input"]
        self.assertIn("must not be broader or more generic", prompt)
        self.assertIsNone(result["suggested_group_name"])
        self.assertEqual(result["split_suggestions"], [])

    def test_organizer_normalizes_split_suggestions(self):
        openai_response = {
            "query_variations": ["Turkey agenda"],
            "domains": [],
            "country": "tr",
            "languages": ["tr"],
            "topic_warning": "Topic is broad. Consider creating focused topics.",
            "suggested_group_name": "Turkey agenda",
            "split_topics": [
                {
                    "monitoring_prompt": "Türkiye ekonomi gündemi",
                    "display_title": "Monitor Turkish political developments and policy announcements",
                    "query_variations": [
                        "Turkey economy agenda",
                        "Turkey inflation markets",
                        "Turkey economy agenda",
                    ],
                    "domains": [
                        "https://www.reuters.com/world/middle-east/",
                        "reuters.com",
                        "bloomberg.com",
                    ],
                    "country": "tr",
                    "languages": ["TR", "en"],
                    "topic_warning": "",
                },
                {
                    "monitoring_prompt": "Türkiye ekonomi gündemi",
                    "display_title": "Duplicate should be ignored",
                    "query_variations": ["duplicate"],
                    "country": "TR",
                    "languages": ["tr"],
                },
                {
                    "monitoring_prompt": "   ",
                    "display_title": "",
                    "query_variations": [],
                },
                {
                    "topic": "Netherlands economy agenda",
                    "query_variations": [],
                    "domains": ["nltimes.nl"],
                    "country": "NL",
                    "languages": ["NL"],
                    "topic_warning": "Unsupported country should be ignored.",
                },
            ],
        }

        with patch("newsradar.topics.services.OpenAI") as openai_cls:
            openai_cls.return_value.responses.create.return_value = SimpleNamespace(
                output_text=json.dumps(openai_response)
            )
            result = organize_topic_configuration("Türkiye gündemi")

        self.assertEqual(result["topic_warning"], "Topic is broad. Consider creating focused topics.")
        self.assertEqual(result["suggested_group_name"], "Turkey agenda")
        self.assertEqual(len(result["split_suggestions"]), 1)
        first = result["split_suggestions"][0]
        self.assertEqual(first["monitoring_prompt"], "Türkiye ekonomi gündemi")
        self.assertEqual(first["display_title"], "politics")
        self.assertEqual(
            first["query_variations"],
            ["Turkey economy agenda", "Turkey inflation markets"],
        )
        self.assertEqual(first["suggested_domains"], ["reuters.com", "bloomberg.com"])
        self.assertEqual(first["country"], "TR")
        self.assertEqual(first["search_language_filter"], ["tr", "en"])

    @override_settings(OPENAI_API_KEY="")
    def test_organizer_falls_back_without_openai_key(self):
        result = organize_topic_configuration("Türkiye gündemi")

        self.assertEqual(result["display_title"], "Türkiye gündemi")
        self.assertEqual(result["query_variations"], ["Türkiye gündemi"])
        self.assertEqual(result["suggested_domains"], [])
        self.assertEqual(result["country"], "TR")
        self.assertEqual(result["search_language_filter"], ["tr"])
        self.assertIsNone(result["topic_warning"])
        self.assertIsNone(result["suggested_group_name"])
        self.assertEqual(result["split_suggestions"], [])

    def test_refine_uses_current_configuration_when_feedback_is_empty(self):
        result = refine_topic_configuration(
            "Grid reliability",
            queries=["grid reliability", "grid outage risk"],
            domains=["iea.org"],
            country="US",
            languages=["en"],
            feedback_items=[],
        )

        self.assertEqual(result["query_variations"], ["grid reliability", "grid outage risk"])
        self.assertEqual(result["suggested_domains"], ["iea.org"])
        self.assertEqual(result["country"], "US")
        self.assertEqual(result["search_language_filter"], ["en"])
        self.assertIsNone(result["topic_warning"])

    def test_suggest_more_domains_filters_existing_and_caps_to_remaining(self):
        openai_response = {
            "domains": [
                "trade.gov",
                "bloomberg.com",
                "ft.com",
                "wsj.com",
            ]
        }

        with patch("newsradar.topics.services.OpenAI") as openai_cls:
            openai_cls.return_value.responses.create.return_value = SimpleNamespace(
                output_text=json.dumps(openai_response)
            )
            result = suggest_more_domains(
                "EV policy",
                selected_domains=["trade.gov", "reuters.com"],
            )

        self.assertEqual(result, ["bloomberg.com", "ft.com", "wsj.com"])

    def test_suggest_more_domains_filters_non_domain_explanations(self):
        openai_response = {
            "domains": [
                "international outlets like reuters or bbc in turkish",
                "https://www.bbc.com/turkce",
                "reuters.com",
            ]
        }

        with patch("newsradar.topics.services.OpenAI") as openai_cls:
            openai_cls.return_value.responses.create.return_value = SimpleNamespace(
                output_text=json.dumps(openai_response)
            )
            result = suggest_more_domains(
                "Türkiye gündemi",
                selected_domains=["aa.com.tr"],
            )

        prompt = openai_cls.return_value.responses.create.call_args.kwargs["input"]
        self.assertIn("one real website domain in hostname format", prompt)
        self.assertIn("Never return outlet names", prompt)
        self.assertEqual(result, ["bbc.com", "reuters.com"])

    def test_normalize_domain_value_rejects_explanatory_text(self):
        self.assertIsNone(
            normalize_domain_value("international outlets like reuters or bbc in turkish")
        )
        self.assertEqual(normalize_domain_value("https://www.reuters.com/world/"), "reuters.com")


class TopicApiTests(TopicTestCase):
    def setUp(self):
        super().setUp()
        self.client.force_login(self.user)

    def _create_topic(self) -> Topic:
        return Topic.objects.create(
            user=self.user,
            monitoring_prompt="battery recycling",
            display_title="Battery recycling",
            queries=["battery recycling", "battery recycling policy"],
            update_frequency=Topic.UPDATE_FREQUENCY_AUTO,
            auto_effective_interval_hours=6,
        )

    def test_create_topic_persists_reviewed_payload(self):
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
        self.assertIsNotNone(payload["group_uuid"])
        self.assertEqual(payload["group_name"], "Turkey EV policy")
        self.assertTrue(TopicGroup.objects.filter(name="Turkey EV policy", topics__uuid=payload["uuid"]).exists())

    def test_topic_without_group_creates_one_topic_collection(self):
        topic = Topic.objects.create(
            user=self.user,
            monitoring_prompt="Judicial appointments",
            display_title="Judicial appointments",
            queries=["judicial appointments"],
            update_frequency=Topic.UPDATE_FREQUENCY_MANUAL,
        )

        self.assertIsNotNone(topic.group_id)
        self.assertEqual(topic.group.name, "Judicial appointments")
        self.assertTrue(topic.group.is_active)

    def test_default_collection_names_get_duplicate_suffixes(self):
        first = Topic.objects.create(
            user=self.user,
            monitoring_prompt="Grid reliability",
            display_title="Grid reliability",
            queries=["grid reliability"],
            update_frequency=Topic.UPDATE_FREQUENCY_MANUAL,
        )
        second = Topic.objects.create(
            user=self.user,
            monitoring_prompt="Grid reliability",
            display_title="Grid reliability",
            queries=["grid reliability outage"],
            update_frequency=Topic.UPDATE_FREQUENCY_MANUAL,
        )

        self.assertEqual(first.group.name, "Grid reliability")
        self.assertEqual(second.group.name, "Grid reliability 2")

    def test_topic_group_field_is_required(self):
        group_field = Topic._meta.get_field("group")

        self.assertFalse(group_field.null)
        self.assertFalse(group_field.blank)

    def test_update_topic_replaces_fixed_queries(self):
        topic = self._create_topic()
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

    def test_organize_endpoint_uses_prompt_only(self):
        with patch("newsradar.topics.api.organize_topic_configuration") as organize_mock:
            organize_mock.return_value = {
                "display_title": "EV policy",
                "query_variations": ["electric vehicle policy", "EV incentives"],
                "suggested_domains": ["trade.gov", "reuters.com"],
                "country": "US",
                "search_language_filter": ["en"],
                "topic_warning": "Topic is broad. Consider tracking EV incentives only.",
                "suggested_group_name": "EV policy",
                "split_suggestions": [
                    {
                        "monitoring_prompt": "EV incentives",
                        "display_title": "EV incentives",
                        "query_variations": ["electric vehicle incentives"],
                        "suggested_domains": ["trade.gov"],
                        "country": "US",
                        "search_language_filter": ["en"],
                        "topic_warning": None,
                    }
                ],
            }
            response = self.client.post(
                "/api/topics/organize",
                data=json.dumps(
                    {
                        "monitoring_prompt": "EV policy",
                    }
                ),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        organize_mock.assert_called_once_with("EV policy")
        self.assertEqual(response.json()["suggested_domains"], ["trade.gov", "reuters.com"])
        self.assertEqual(
            response.json()["topic_warning"],
            "Topic is broad. Consider tracking EV incentives only.",
        )
        self.assertEqual(response.json()["suggested_group_name"], "EV policy")
        self.assertEqual(response.json()["split_suggestions"][0]["display_title"], "EV incentives")

    def test_bulk_create_topics_persists_multiple_payloads(self):
        group = TopicGroup.objects.create(
            user=self.user,
            name="Agenda",
            description="Focused topics",
        )
        response = self.client.post(
            "/api/topics/bulk",
            data=json.dumps(
                {
                    "topics": [
                        {
                            "monitoring_prompt": "Türkiye ekonomi gündemi",
                            "display_title": "Turkey economy agenda",
                            "primary_query": "Turkey economy agenda",
                            "query_variations": [
                                "Turkey inflation markets",
                                "Turkey economy agenda",
                            ],
                            "group_uuid": str(group.uuid),
                            "search_domain_allowlist": [
                                "Reuters.com",
                                "https://www.reuters.com/world/",
                                "Bloomberg.com",
                            ],
                            "search_language_filter": ["TR", "en", "TR"],
                            "country": "tr",
                            "update_frequency": "auto",
                            "auto_effective_interval_hours": 8,
                        },
                        {
                            "monitoring_prompt": "Türkiye siyaset gündemi",
                            "display_title": "Turkey politics agenda",
                            "primary_query": "Turkey politics agenda",
                            "query_variations": ["Turkey elections policy"],
                            "group_uuid": str(group.uuid),
                            "search_language_filter": ["tr"],
                            "country": "TR",
                            "update_frequency": "day",
                            "auto_effective_interval_hours": 12,
                        },
                    ]
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()["topics"]
        self.assertEqual(len(payload), 2)
        self.assertEqual(Topic.objects.count(), 2)

        economy = Topic.objects.get(display_title="Turkey economy agenda")
        self.assertEqual(economy.group_id, group.id)
        self.assertEqual(
            economy.queries,
            ["Turkey economy agenda", "Turkey inflation markets"],
        )
        self.assertEqual(economy.search_domain_allowlist, ["reuters.com", "bloomberg.com"])
        self.assertEqual(economy.search_language_filter, ["tr", "en"])
        self.assertEqual(economy.country, "TR")
        self.assertEqual(economy.auto_effective_interval_hours, 8)

        politics = Topic.objects.get(display_title="Turkey politics agenda")
        self.assertEqual(politics.update_frequency, Topic.UPDATE_FREQUENCY_DAY)
        self.assertIsNone(politics.auto_effective_interval_hours)
        self.assertEqual(payload[0]["display_title"], "Turkey economy agenda")
        self.assertEqual(payload[1]["display_title"], "Turkey politics agenda")
        self.assertEqual(TopicGroup.objects.count(), 1)

    def test_bulk_create_without_group_creates_one_collection_per_topic(self):
        response = self.client.post(
            "/api/topics/bulk",
            data=json.dumps(
                {
                    "topics": [
                        {
                            "monitoring_prompt": "Court appointments",
                            "display_title": "Court appointments",
                            "primary_query": "court appointments",
                        },
                        {
                            "monitoring_prompt": "Judicial independence",
                            "display_title": "Judicial independence",
                            "primary_query": "judicial independence",
                        },
                    ]
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(Topic.objects.count(), 2)
        self.assertEqual(TopicGroup.objects.count(), 2)
        self.assertEqual(
            set(TopicGroup.objects.values_list("name", flat=True)),
            {"Court appointments", "Judicial independence"},
        )

    def test_bulk_create_rolls_back_when_later_topic_is_invalid(self):
        response = self.client.post(
            "/api/topics/bulk",
            data=json.dumps(
                {
                    "topics": [
                        {
                            "monitoring_prompt": "Valid topic",
                            "display_title": "Valid topic",
                            "primary_query": "valid topic",
                        },
                        {
                            "monitoring_prompt": "Invalid country",
                            "display_title": "Invalid country",
                            "primary_query": "invalid country",
                            "country": "TUR",
                        },
                    ]
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Topic.objects.count(), 0)
        self.assertEqual(TopicGroup.objects.count(), 0)

    def test_preview_endpoint_returns_items(self):
        with patch("newsradar.topics.api.preview_web_search") as preview_mock:
            preview_mock.return_value = {
                "items": [
                    {
                        "url": "https://www.reuters.com/example",
                        "title": "Story",
                        "snippet": "Summary",
                        "domain": "reuters.com",
                        "published_at": None,
                    }
                ]
            }
            response = self.client.post(
                "/api/topics/preview",
                data=json.dumps(
                    {
                        "queries": ["battery recycling", "battery recycling policy"],
                        "search_domain_allowlist": ["Reuters.com"],
                        "search_language_filter": ["EN"],
                        "country": "us",
                    }
                ),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        preview_mock.assert_called_once_with(
            queries=["battery recycling", "battery recycling policy"],
            search_domain_allowlist=["reuters.com"],
            search_language_filter=["en"],
            country="US",
        )
        self.assertEqual(response.json()["items"][0]["domain"], "reuters.com")

    def test_refine_endpoint_passes_feedback(self):
        with patch("newsradar.topics.api.refine_topic_configuration") as refine_mock:
            refine_mock.return_value = {
                "display_title": "Grid reliability",
                "query_variations": ["grid reliability", "grid resilience"],
                "suggested_domains": ["iea.org"],
                "country": "US",
                "search_language_filter": ["en"],
                "topic_warning": "Topic may still be wide. Consider focusing on outage risk or grid resilience.",
            }
            response = self.client.post(
                "/api/topics/refine",
                data=json.dumps(
                    {
                        "monitoring_prompt": "Grid reliability",
                        "queries": ["grid reliability"],
                        "search_domain_allowlist": ["IEA.org"],
                        "search_language_filter": ["EN"],
                        "country": "us",
                        "feedback": [
                            {
                                "url": "https://www.example.com/story",
                                "title": "Story",
                                "snippet": "Summary",
                                "domain": "example.com",
                                "reaction": "down",
                            }
                        ],
                    }
                ),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        refine_mock.assert_called_once()
        self.assertEqual(refine_mock.call_args.kwargs["queries"], ["grid reliability"])
        self.assertEqual(refine_mock.call_args.kwargs["domains"], ["iea.org"])
        self.assertEqual(refine_mock.call_args.kwargs["country"], "US")
        self.assertEqual(refine_mock.call_args.kwargs["languages"], ["en"])
        self.assertEqual(
            refine_mock.call_args.kwargs["feedback_items"][0]["reaction"],
            "down",
        )
        self.assertEqual(
            response.json()["topic_warning"],
            "Topic may still be wide. Consider focusing on outage risk or grid resilience.",
        )

    def test_suggest_domains_endpoint_normalizes_input(self):
        with patch("newsradar.topics.api.suggest_more_domains") as suggest_mock:
            suggest_mock.return_value = ["bloomberg.com", "ft.com"]
            response = self.client.post(
                "/api/topics/suggest-domains",
                data=json.dumps(
                    {
                        "monitoring_prompt": "EV policy",
                        "selected_domains": ["Reuters.com", "trade.gov"],
                    }
                ),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        suggest_mock.assert_called_once_with(
            "EV policy",
            selected_domains=["reuters.com", "trade.gov"],
        )
        self.assertEqual(response.json()["domains"], ["bloomberg.com", "ft.com"])

    def test_group_create_update_deactivate_roundtrip(self):
        response = self.client.post(
            "/api/topics/groups",
            data=json.dumps({"name": "Signals", "description": "My group"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        group_uuid = response.json()["group"]["uuid"]

        update_response = self.client.patch(
            f"/api/topics/groups/{group_uuid}",
            data=json.dumps({"name": "Signals updated", "description": "Updated", "is_active": False}),
            content_type="application/json",
        )
        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.json()["name"], "Signals updated")
        self.assertFalse(update_response.json()["is_active"])

        list_response = self.client.get("/api/topics/groups")
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(list_response.json()["groups"], [])

        management_response = self.client.get("/api/topics/groups?include_inactive=true")
        self.assertEqual(management_response.status_code, 200)
        self.assertEqual(len(management_response.json()["groups"]), 1)
        self.assertFalse(management_response.json()["groups"][0]["is_active"])

        reactivate_response = self.client.patch(
            f"/api/topics/groups/{group_uuid}",
            data=json.dumps({"is_active": True}),
            content_type="application/json",
        )
        self.assertEqual(reactivate_response.status_code, 200)
        self.assertTrue(reactivate_response.json()["is_active"])

        delete_response = self.client.delete(f"/api/topics/groups/{group_uuid}")
        self.assertEqual(delete_response.status_code, 200)
        group = TopicGroup.objects.get(uuid=group_uuid)
        self.assertFalse(group.is_active)

    def test_create_topic_rejects_inactive_collection(self):
        group = TopicGroup.objects.create(
            user=self.user,
            name="Inactive",
            is_active=False,
        )

        response = self.client.post(
            "/api/topics/",
            data=json.dumps(
                {
                    "monitoring_prompt": "Inactive collection topic",
                    "display_title": "Inactive collection topic",
                    "primary_query": "inactive collection topic",
                    "group_uuid": str(group.uuid),
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Topic.objects.count(), 0)

    def test_topic_list_hides_inactive_topics_by_default(self):
        active_topic = self._create_topic()
        inactive_topic = Topic.objects.create(
            user=self.user,
            monitoring_prompt="disabled topic",
            display_title="Disabled topic",
            queries=["disabled topic"],
            update_frequency=Topic.UPDATE_FREQUENCY_MANUAL,
            is_active=False,
        )

        response = self.client.get("/api/topics/")
        management_response = self.client.get("/api/topics/?include_inactive=true")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {item["uuid"] for item in response.json()["topics"]},
            {str(active_topic.uuid)},
        )
        self.assertEqual(management_response.status_code, 200)
        self.assertEqual(
            {item["uuid"] for item in management_response.json()["topics"]},
            {str(active_topic.uuid), str(inactive_topic.uuid)},
        )

    def test_delete_topic_deactivates_topic(self):
        topic = self._create_topic()

        response = self.client.delete(f"/api/topics/{topic.uuid}")

        self.assertEqual(response.status_code, 200)
        topic.refresh_from_db()
        self.assertFalse(topic.is_active)
        self.assertEqual(Topic.objects.count(), 1)

    def test_group_list_endpoint_does_not_collide_with_topic_uuid_route(self):
        TopicGroup.objects.create(
            user=self.user,
            name="Signals",
            description="My group",
        )

        response = self.client.get("/api/topics/groups")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["groups"]), 1)
