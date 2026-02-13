from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail

from newsradar.contents.models import Content
from newsradar.executions.models import Execution


def _build_topic_label(queries: list[str]) -> str:
    cleaned = [
        query.strip()
        for query in queries
        if isinstance(query, str) and query.strip()
    ]
    if not cleaned:
        return "your topic"
    if len(cleaned) == 1:
        return cleaned[0]
    return ", ".join(cleaned[:2])


@shared_task(name="contents.send_new_items_email_notification")
def send_new_items_email_notification(execution_id: int) -> dict:
    execution = (
        Execution.objects.select_related("topic__user")
        .only(
            "id",
            "topic__id",
            "topic__queries",
            "topic__user__email",
            "topic__user__first_name",
            "topic__user__username",
        )
        .filter(id=execution_id)
        .first()
    )
    if not execution:
        return {"sent": False, "reason": "execution_not_found"}

    recipient = (execution.topic.user.email or "").strip()
    if not recipient:
        return {"sent": False, "reason": "missing_email"}

    items = list(
        Content.objects.filter(
            execution_id=execution.id,
            deleted_at__isnull=True,
        )
        .order_by("-created_at", "-id")
        .values_list("title", "url")
    )
    if not items:
        return {"sent": False, "reason": "no_new_items"}

    topic_label = _build_topic_label(execution.topic.queries or [])
    item_count = len(items)
    item_suffix = "item" if item_count == 1 else "items"
    subject = f"NewsRadar: {item_count} new {item_suffix} for {topic_label}"

    display_name = (
        execution.topic.user.first_name.strip()
        if execution.topic.user.first_name
        else execution.topic.user.username
    ) or "there"
    message_lines = [
        f"Hi {display_name},",
        "",
        f"Your latest NewsRadar scan found {item_count} new {item_suffix}:",
        "",
    ]
    for index, (title, url) in enumerate(items, start=1):
        message_lines.append(f"{index}. {(title or '').strip() or url}")
        message_lines.append(f"   {url}")
        message_lines.append("")
    message_lines.append(
        "You are receiving this email because your latest scan found new content."
    )

    send_mail(
        subject,
        "\n".join(message_lines),
        settings.DEFAULT_FROM_EMAIL,
        [recipient],
        fail_silently=False,
    )
    return {"sent": True, "recipient": recipient, "count": item_count}
