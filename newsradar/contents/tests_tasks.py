from io import StringIO
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from newsradar.contents.models import Content
from newsradar.contents.tasks import send_new_items_email_notification
from newsradar.executions.models import Execution
from newsradar.topics.models import Topic


class ContentDigestEmailCommandTests(TestCase):
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

    def test_command_sends_digest_for_unviewed_content_and_marks_it_viewed(self):
        user_model = get_user_model()
        user = user_model.objects.create_user(
            username="digest-user",
            email="digest-user@example.com",
            password="password123",
            first_name="Digest",
        )
        topic_one = self._create_topic_for_user(user, query="battery recycling")
        topic_two = self._create_topic_for_user(user, query="lithium supply")

        unseen_one = self._create_content(
            topic=topic_one,
            url="https://example.com/story-1",
            title="Story one",
        )
        unseen_two = self._create_content(
            topic=topic_one,
            url="https://example.com/story-2",
            title="Story two",
        )
        unseen_three = self._create_content(
            topic=topic_two,
            url="https://example.com/story-3",
            title="Story three",
        )
        already_viewed = self._create_content(
            topic=topic_two,
            url="https://example.com/already-viewed",
            title="Already viewed",
            viewed=True,
        )
        deleted_content = self._create_content(
            topic=topic_two,
            url="https://example.com/deleted",
            title="Deleted story",
            deleted_at=timezone.now(),
        )

        stdout = StringIO()
        with patch("newsradar.contents.digests.send_mail") as send_mail_mock:
            call_command("send_content_digest_emails", stdout=stdout)

        send_mail_mock.assert_called_once()
        subject, message, _, recipients = send_mail_mock.call_args.args[:4]
        self.assertIn("3 new items across 2 topics", subject)
        self.assertIn("https://example.com/story-1", message)
        self.assertIn("https://example.com/story-2", message)
        self.assertIn("https://example.com/story-3", message)
        self.assertNotIn("https://example.com/already-viewed", message)
        self.assertNotIn("https://example.com/deleted", message)
        self.assertEqual(recipients, ["digest-user@example.com"])

        unseen_one.refresh_from_db()
        unseen_two.refresh_from_db()
        unseen_three.refresh_from_db()
        already_viewed.refresh_from_db()
        deleted_content.refresh_from_db()
        self.assertTrue(unseen_one.viewed)
        self.assertTrue(unseen_two.viewed)
        self.assertTrue(unseen_three.viewed)
        self.assertTrue(already_viewed.viewed)
        self.assertFalse(deleted_content.viewed)

        self.assertIn("processed_users=1", stdout.getvalue())
        self.assertIn("sent_users=1", stdout.getvalue())
        self.assertIn("marked_viewed=3", stdout.getvalue())

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
