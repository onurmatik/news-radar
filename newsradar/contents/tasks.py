"""Legacy Celery tasks kept only to disable old realtime email behavior."""

from celery import shared_task


@shared_task(name="contents.send_new_items_email_notification")
def send_new_items_email_notification(execution_id: int) -> dict:
    return {
        "sent": False,
        "reason": "disabled_replaced_by_digest_command",
        "execution_id": execution_id,
    }
