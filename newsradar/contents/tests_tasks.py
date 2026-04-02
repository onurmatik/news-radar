from io import StringIO
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from newsradar.contents.models import Content
from newsradar.contents.tasks import send_new_items_email_notification
from newsradar.executions.models import Execution
from newsradar.topics.models import Topic, TopicGroup


@override_settings(FRONTEND_BASE_URL="https://newsradar.app/")
class ContentDigestEmailCommandTests(TestCase):
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
                monitoring_prompt=query,
                display_title=query.title(),
                queries=[query],
                update_frequency="manual",
            )

    def _create_content(
        self,
        *,
        topic: Topic,
        url: str,
        title: str,
        viewed: bool = False,
        deleted_at=None,
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
            viewed=viewed,
            deleted_at=deleted_at,
        )

    def test_command_groups_by_topic_group_limits_each_group_and_marks_only_sent_items_viewed(self):
        user_model = get_user_model()
        user = user_model.objects.create_user(
            username="digest-user",
            email="digest-user@example.com",
            password="password123",
            first_name="Digest",
        )
        energy_group = TopicGroup.objects.create(user=user, name="Energy")
        mining_group = TopicGroup.objects.create(user=user, name="Mining")
        energy_topic = self._create_topic_for_user(
            user,
            query="battery recycling",
            group=energy_group,
        )
        mining_topic = self._create_topic_for_user(
            user,
            query="battery recycling",
            group=mining_group,
        )

        energy_contents = [
            self._create_content(
                topic=energy_topic,
                url=f"https://example.com/energy-{index}",
                title=f"Energy story {index}",
            )
            for index in range(6)
        ]
        mining_one = self._create_content(
            topic=mining_topic,
            url="https://example.com/mining-1",
            title="Mining story one",
        )
        mining_two = self._create_content(
            topic=mining_topic,
            url="https://example.com/mining-2",
            title="Mining story two",
        )
        already_viewed = self._create_content(
            topic=mining_topic,
            url="https://example.com/already-viewed",
            title="Already viewed",
            viewed=True,
        )
        deleted_content = self._create_content(
            topic=mining_topic,
            url="https://example.com/deleted",
            title="Deleted story",
            deleted_at=timezone.now(),
        )

        stdout = StringIO()
        with patch("newsradar.contents.digests.send_mail") as send_mail_mock:
            call_command("send_content_digest_emails", stdout=stdout)

        send_mail_mock.assert_called_once()
        subject, message, _, recipients = send_mail_mock.call_args.args[:4]
        self.assertIn("8 new items across 2 topic groups", subject)
        self.assertIn("Showing the most recent 5 items per topic group below.", message)
        self.assertIn("Energy (5)", message)
        self.assertIn("Mining (2)", message)
        self.assertIn(f"Topic group: https://newsradar.app/?group={energy_group.uuid}", message)
        self.assertIn(f"Topic group: https://newsradar.app/?group={mining_group.uuid}", message)
        self.assertIn("https://example.com/energy-1", message)
        self.assertIn("https://example.com/energy-2", message)
        self.assertIn("https://example.com/energy-3", message)
        self.assertIn("https://example.com/energy-4", message)
        self.assertIn("https://example.com/energy-5", message)
        self.assertNotIn("https://example.com/energy-0", message)
        self.assertIn("https://example.com/mining-1", message)
        self.assertIn("https://example.com/mining-2", message)
        self.assertIn(
            f"Topic: https://newsradar.app/?group={energy_group.uuid}&topic={energy_topic.uuid}",
            message,
        )
        self.assertIn(
            f"Topic: https://newsradar.app/?group={mining_group.uuid}&topic={mining_topic.uuid}",
            message,
        )
        self.assertIn(
            f"1 more item in this topic group: https://newsradar.app/?group={energy_group.uuid}",
            message,
        )
        self.assertNotIn("https://example.com/already-viewed", message)
        self.assertNotIn("https://example.com/deleted", message)
        self.assertEqual(recipients, ["digest-user@example.com"])

        for content in energy_contents[1:]:
            content.refresh_from_db()
            self.assertTrue(content.viewed)
        energy_contents[0].refresh_from_db()
        mining_one.refresh_from_db()
        mining_two.refresh_from_db()
        already_viewed.refresh_from_db()
        deleted_content.refresh_from_db()
        self.assertTrue(energy_contents[0].viewed)
        self.assertTrue(mining_one.viewed)
        self.assertTrue(mining_two.viewed)
        self.assertTrue(already_viewed.viewed)
        self.assertFalse(deleted_content.viewed)

        self.assertIn("processed_users=1", stdout.getvalue())
        self.assertIn("sent_users=1", stdout.getvalue())
        self.assertIn("items_sent=7", stdout.getvalue())
        self.assertIn("marked_viewed=8", stdout.getvalue())

    def test_command_skips_users_without_email_and_leaves_content_unviewed(self):
        user_model = get_user_model()
        user = user_model.objects.create_user(
            username="no-email-user",
            email="",
            password="password123",
        )
        topic = self._create_topic_for_user(user, query="battery recycling")
        content = self._create_content(
            topic=topic,
            url="https://example.com/story-1",
            title="Story one",
        )

        stdout = StringIO()
        with patch("newsradar.contents.digests.send_mail") as send_mail_mock:
            call_command("send_content_digest_emails", stdout=stdout)

        send_mail_mock.assert_not_called()
        content.refresh_from_db()
        self.assertFalse(content.viewed)
        self.assertIn("processed_users=1", stdout.getvalue())
        self.assertIn("skipped_users=1", stdout.getvalue())
        self.assertIn("marked_viewed=0", stdout.getvalue())

    def test_command_dry_run_does_not_send_or_mark_content_viewed(self):
        user_model = get_user_model()
        user = user_model.objects.create_user(
            username="dry-run-user",
            email="dry-run@example.com",
            password="password123",
        )
        topic = self._create_topic_for_user(user, query="energy storage")
        content = self._create_content(
            topic=topic,
            url="https://example.com/story-1",
            title="Story one",
        )

        stdout = StringIO()
        with patch("newsradar.contents.digests.send_mail") as send_mail_mock:
            call_command("send_content_digest_emails", "--dry-run", stdout=stdout)

        send_mail_mock.assert_not_called()
        content.refresh_from_db()
        self.assertFalse(content.viewed)
        self.assertIn("sent_users=1", stdout.getvalue())
        self.assertIn("marked_viewed=0", stdout.getvalue())
        self.assertIn("dry_run=True", stdout.getvalue())

    def test_legacy_realtime_email_task_is_disabled(self):
        self.assertEqual(
            send_new_items_email_notification(42),
            {
                "sent": False,
                "reason": "disabled_replaced_by_digest_command",
                "execution_id": 42,
            },
        )
