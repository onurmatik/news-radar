import logging
from collections import OrderedDict
from collections.abc import Iterable

from django.conf import settings
from django.core.mail import send_mail

from newsradar.contents.models import Content

logger = logging.getLogger(__name__)


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


def _build_digest_subject(item_count: int, topic_count: int) -> str:
    item_suffix = "item" if item_count == 1 else "items"
    topic_suffix = "topic" if topic_count == 1 else "topics"
    return (
        f"NewsRadar digest: {item_count} new {item_suffix} "
        f"across {topic_count} {topic_suffix}"
    )


def _build_digest_message(*, user, contents: list[Content]) -> str:
    display_name = (
        user.first_name.strip() if getattr(user, "first_name", "") else user.username
    ) or "there"
    topics: OrderedDict[str, list[Content]] = OrderedDict()
    for content in contents:
        topic_label = _build_topic_label(content.topic.queries or [])
        topics.setdefault(topic_label, []).append(content)

    message_lines = [
        f"Hi {display_name},",
        "",
        (
            f"Your NewsRadar digest includes {len(contents)} new "
            f"{'item' if len(contents) == 1 else 'items'} "
            f"across {len(topics)} {'topic' if len(topics) == 1 else 'topics'}:"
        ),
        "",
    ]

    for topic_label, topic_contents in topics.items():
        message_lines.append(f"{topic_label} ({len(topic_contents)})")
        for index, content in enumerate(topic_contents, start=1):
            message_lines.append(f"{index}. {(content.title or '').strip() or content.url}")
            message_lines.append(f"   {content.url}")
        message_lines.append("")

    message_lines.append(
        "These items have been marked as viewed so they are not sent again."
    )
    return "\n".join(message_lines)


def send_unviewed_content_email_digests(
    *,
    user_ids: Iterable[int] | None = None,
    dry_run: bool = False,
) -> dict:
    pending_content = (
        Content.objects.filter(
            deleted_at__isnull=True,
            viewed=False,
        )
        .select_related("topic__user")
        .only(
            "id",
            "topic_id",
            "url",
            "title",
            "created_at",
            "topic__id",
            "topic__queries",
            "topic__user__id",
            "topic__user__email",
            "topic__user__first_name",
            "topic__user__username",
        )
        .order_by("topic__user_id", "topic_id", "-created_at", "-id")
    )
    if user_ids is not None:
        pending_content = pending_content.filter(topic__user_id__in=list(user_ids))

    pending_by_user: OrderedDict[int, dict] = OrderedDict()
    for content in pending_content:
        user = content.topic.user
        bucket = pending_by_user.setdefault(
            user.id,
            {
                "user": user,
                "recipient": (user.email or "").strip(),
                "contents": [],
                "content_ids": [],
            },
        )
        bucket["contents"].append(content)
        bucket["content_ids"].append(content.id)

    summary = {
        "dry_run": dry_run,
        "processed_users": len(pending_by_user),
        "sent_users": 0,
        "skipped_users": 0,
        "items_sent": 0,
        "marked_viewed": 0,
        "user_results": [],
    }

    for user_id, bucket in pending_by_user.items():
        recipient = bucket["recipient"]
        contents = bucket["contents"]
        content_ids = bucket["content_ids"]
        if not recipient:
            summary["skipped_users"] += 1
            summary["user_results"].append(
                {
                    "user_id": user_id,
                    "sent": False,
                    "reason": "missing_email",
                    "count": len(contents),
                }
            )
            continue

        if dry_run:
            summary["sent_users"] += 1
            summary["items_sent"] += len(contents)
            summary["user_results"].append(
                {
                    "user_id": user_id,
                    "recipient": recipient,
                    "sent": True,
                    "dry_run": True,
                    "count": len(contents),
                }
            )
            continue

        subject = _build_digest_subject(
            item_count=len(contents),
            topic_count=len(
                {
                    content.topic_id
                    for content in contents
                }
            ),
        )
        message = _build_digest_message(user=bucket["user"], contents=contents)

        try:
            send_mail(
                subject,
                message,
                settings.DEFAULT_FROM_EMAIL,
                [recipient],
                fail_silently=False,
            )
        except Exception:
            logger.exception(
                "Failed to send content digest email for user %s",
                user_id,
            )
            summary["skipped_users"] += 1
            summary["user_results"].append(
                {
                    "user_id": user_id,
                    "recipient": recipient,
                    "sent": False,
                    "reason": "send_failed",
                    "count": len(contents),
                }
            )
            continue

        marked_viewed = Content.objects.filter(
            id__in=content_ids,
            viewed=False,
        ).update(viewed=True)
        summary["sent_users"] += 1
        summary["items_sent"] += len(contents)
        summary["marked_viewed"] += marked_viewed
        summary["user_results"].append(
            {
                "user_id": user_id,
                "recipient": recipient,
                "sent": True,
                "count": len(contents),
                "marked_viewed": marked_viewed,
            }
        )

    return summary
