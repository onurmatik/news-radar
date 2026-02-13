from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from newsradar.contents.models import Content
from newsradar.contents.tasks import send_new_items_email_notification
from newsradar.executions.models import Execution
from newsradar.topics.models import Topic


class SendNewItemsEmailNotificationTaskTests(TestCase):
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

    def test_sends_email_with_new_items_for_execution(self):
        user_model = get_user_model()
        user = user_model.objects.create_user(
            username="notify-user",
            email="notify-user@example.com",
            password="password123",
            first_name="Notify",
        )
        topic = self._create_topic_for_user(user, query="battery recycling")
        execution = Execution.objects.create(
            topic=topic,
            initiator=Execution.Initiator.USER,
            status=Execution.Status.COMPLETED,
        )
        Content.objects.create(
            execution=execution,
            topic=topic,
            url="https://example.com/story-1",
            title="Story one",
        )
        Content.objects.create(
            execution=execution,
            topic=topic,
            url="https://example.com/story-2",
            title="Story two",
        )

        with patch("newsradar.contents.tasks.send_mail") as send_mail_mock:
            result = send_new_items_email_notification(execution.id)

        self.assertTrue(result["sent"])
        self.assertEqual(result["count"], 2)
        send_mail_mock.assert_called_once()
        subject, message, _, recipients = send_mail_mock.call_args.args[:4]
        self.assertIn("2 new items", subject)
        self.assertIn("https://example.com/story-1", message)
        self.assertIn("https://example.com/story-2", message)
        self.assertEqual(recipients, ["notify-user@example.com"])

    def test_skips_sending_when_user_has_no_email(self):
        user_model = get_user_model()
        user = user_model.objects.create_user(
            username="notify-no-email",
            email="",
            password="password123",
        )
        topic = self._create_topic_for_user(user, query="battery recycling")
        execution = Execution.objects.create(
            topic=topic,
            initiator=Execution.Initiator.USER,
            status=Execution.Status.COMPLETED,
        )
        Content.objects.create(
            execution=execution,
            topic=topic,
            url="https://example.com/story-1",
            title="Story one",
        )

        with patch("newsradar.contents.tasks.send_mail") as send_mail_mock:
            result = send_new_items_email_notification(execution.id)

        self.assertFalse(result["sent"])
        self.assertEqual(result["reason"], "missing_email")
        send_mail_mock.assert_not_called()
