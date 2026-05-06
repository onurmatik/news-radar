import logging
from html import escape
from collections import OrderedDict
from collections.abc import Iterable
from urllib.parse import urlencode, urlparse, urlunparse

from django.conf import settings
from django.core.mail import send_mail

from newsradar.contents.models import Content

logger = logging.getLogger(__name__)
MAX_ITEMS_PER_TOPIC_GROUP = 5


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


def _build_digest_subject(item_count: int, topic_group_count: int) -> str:
    item_suffix = "item" if item_count == 1 else "items"
    topic_group_suffix = "collection" if topic_group_count == 1 else "collections"
    return (
        f"NewsRadar digest: {item_count} new {item_suffix} "
        f"across {topic_group_count} {topic_group_suffix}"
    )


def _get_frontend_base_url() -> str | None:
    frontend_url = (settings.FRONTEND_BASE_URL or "").strip()
    if not frontend_url:
        return "https://newsradar.app/"
    parsed = urlparse(frontend_url)
    if not parsed.scheme or not parsed.netloc:
        return "https://newsradar.app/"
    path = parsed.path or "/"
    return urlunparse((parsed.scheme, parsed.netloc, path, "", "", ""))


def _build_dashboard_url(
    *,
    group_uuid: str | None = None,
    topic_uuid: str | None = None,
) -> str | None:
    base_url = _get_frontend_base_url()
    if not base_url:
        return None
    query = {
        key: value
        for key, value in {
            "group": group_uuid,
            "topic": topic_uuid,
        }.items()
        if value
    }
    if not query:
        return base_url
    return f"{base_url}?{urlencode(query)}"


def _build_topic_group_key(content: Content) -> tuple[str, int | None]:
    return ("group", content.topic.group_id)


def _build_topic_group_label(content: Content) -> str:
    if content.topic.group and content.topic.group.name.strip():
        return content.topic.group.name.strip()
    return "Collection"


def _build_topic_group_sections(
    contents: list[Content],
) -> tuple[list[dict], list[Content]]:
    sections: OrderedDict[tuple[str, int | None], dict] = OrderedDict()
    included_contents: list[Content] = []

    for content in contents:
        section_key = _build_topic_group_key(content)
        section = sections.setdefault(
            section_key,
            {
                "label": _build_topic_group_label(content),
                "items": [],
                "total_count": 0,
                "group_uuid": str(content.topic.group.uuid) if content.topic.group else None,
            },
        )
        section["total_count"] += 1
        if len(section["items"]) >= MAX_ITEMS_PER_TOPIC_GROUP:
            continue
        section["items"].append(content)
        included_contents.append(content)

    return list(sections.values()), included_contents


def _build_digest_message(*, user, sections: list[dict], item_count: int) -> str:
    display_name = (
        user.first_name.strip() if getattr(user, "first_name", "") else user.username
    ) or "there"

    message_lines = [
        "Hi,",
        "",
        (
            f"Your NewsRadar digest includes {item_count} new "
            f"{'item' if item_count == 1 else 'items'} "
            f"across {len(sections)} "
            f"{'collection' if len(sections) == 1 else 'collections'}:"
        ),
        "",
        f"Showing the most recent {MAX_ITEMS_PER_TOPIC_GROUP} items per collection below.",
        "",
    ]

    for section in sections:
        section_label = section["label"]
        section_items = section["items"]
        topic_group_url = _build_dashboard_url(group_uuid=section["group_uuid"])
        message_lines.append(f"{section_label} ({len(section_items)})")
        if topic_group_url:
            message_lines.append(f"   Collection: {topic_group_url}")
        for index, content in enumerate(section_items, start=1):
            topic_label = _build_topic_label(content.topic.queries or [])
            title = (content.title or "").strip() or content.url
            topic_url = _build_dashboard_url(
                group_uuid=str(content.topic.group.uuid) if content.topic.group else None,
                topic_uuid=str(content.topic.uuid),
            )
            message_lines.append(f"{index}. [{topic_label}] {title}")
            message_lines.append(f"   Item: {content.url}")
            if topic_url:
                message_lines.append(f"   Topic: {topic_url}")
        remaining_count = section["total_count"] - len(section_items)
        if remaining_count > 0:
            remaining_suffix = "item" if remaining_count == 1 else "items"
            if topic_group_url:
                message_lines.append(
                    f"   {remaining_count} more {remaining_suffix} in this collection: {topic_group_url}"
                )
            else:
                message_lines.append(
                    f"   {remaining_count} more {remaining_suffix} were omitted from this digest."
                )
        message_lines.append("")

    return "\n".join(message_lines)


def _build_digest_message_html(*, user, sections: list[dict], item_count: int) -> str:
    section_count = len(sections)
    message = [
        "<p>Hi,</p>",
        (
            "<p>Your NewsRadar digest includes "
            f"{item_count} new "
            f"{'item' if item_count == 1 else 'items'} "
            f"across {section_count} "
            f"{'collection' if section_count == 1 else 'collections'}:</p>"
        ),
        f"<p>Showing the most recent {MAX_ITEMS_PER_TOPIC_GROUP} items per collection below.</p>",
    ]

    for section in sections:
        section_label = escape(section["label"])
        section_items = section["items"]
        topic_group_url = _build_dashboard_url(group_uuid=section["group_uuid"])
        message.append(f"<h3>{section_label} ({len(section_items)})</h3>")
        if topic_group_url:
            escaped_topic_group_url = escape(topic_group_url)
            message.append(
                f'<p>Collection: <a href="{escaped_topic_group_url}">'
                f"{escaped_topic_group_url}</a></p>"
            )
        message.append("<ul>")
        for index, content in enumerate(section_items, start=1):
            topic_label = escape(_build_topic_label(content.topic.queries or []))
            title = (content.title or "").strip() or content.url
            escaped_title = escape(title)
            topic_url = _build_dashboard_url(
                group_uuid=str(content.topic.group.uuid) if content.topic.group else None,
                topic_uuid=str(content.topic.uuid),
            )
            item_url = escape(content.url)
            message.append("<li>")
            message.append(f"<p>{index}. {topic_label} - {escaped_title}</p>")
            message.append(f"<p>Item: <a href=\"{item_url}\">{item_url}</a></p>")
            if topic_url:
                escaped_topic_url = escape(topic_url)
                message.append(
                    f"<p>Topic: <a href=\"{escaped_topic_url}\">{escaped_topic_url}</a></p>"
                )
            message.append("</li>")
        remaining_count = section["total_count"] - len(section_items)
        if remaining_count > 0:
            remaining_suffix = "item" if remaining_count == 1 else "items"
            if topic_group_url:
                message.append(
                    f"<li>{remaining_count} more {remaining_suffix} in this collection: "
                    f"<a href=\"{escaped_topic_group_url}\">{escaped_topic_group_url}</a></li>"
                )
            else:
                message.append(
                    f"<li>{remaining_count} more {remaining_suffix} were omitted from this digest.</li>"
                )
        message.append("</ul>")

    return "".join(message)


def send_unviewed_content_email_digests(
    *,
    user_ids: Iterable[int] | None = None,
    dry_run: bool = False,
) -> dict:
    pending_content = (
        Content.objects.filter(
            deleted_at__isnull=True,
            viewed=False,
            topic__is_active=True,
            topic__group__is_active=True,
        )
        .select_related("topic__group", "topic__user")
        .only(
            "id",
            "topic_id",
            "url",
            "title",
            "created_at",
            "topic__id",
            "topic__uuid",
            "topic__group_id",
            "topic__group__id",
            "topic__group__uuid",
            "topic__group__name",
            "topic__queries",
            "topic__user__id",
            "topic__user__email",
            "topic__user__first_name",
            "topic__user__username",
        )
        .order_by("topic__user_id", "-created_at", "-id")
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
            },
        )
        bucket["contents"].append(content)

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
        sections, included_contents = _build_topic_group_sections(contents)
        content_ids = [content.id for content in contents]
        total_count = len(contents)
        included_count = len(included_contents)
        if not recipient:
            summary["skipped_users"] += 1
            summary["user_results"].append(
                {
                    "user_id": user_id,
                    "sent": False,
                    "reason": "missing_email",
                    "count": total_count,
                }
            )
            continue

        if dry_run:
            summary["sent_users"] += 1
            summary["items_sent"] += included_count
            summary["user_results"].append(
                {
                    "user_id": user_id,
                    "recipient": recipient,
                    "sent": True,
                    "dry_run": True,
                    "count": total_count,
                    "displayed_count": included_count,
                }
            )
            continue

        subject = _build_digest_subject(
            item_count=total_count,
            topic_group_count=len(sections),
        )
        message = _build_digest_message(
            user=bucket["user"],
            sections=sections,
            item_count=total_count,
        )
        html_message = _build_digest_message_html(
            user=bucket["user"],
            sections=sections,
            item_count=total_count,
        )

        try:
            send_mail(
                subject,
                message,
                settings.DEFAULT_FROM_EMAIL,
                [recipient],
                fail_silently=False,
                html_message=html_message,
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
                    "count": total_count,
                    "displayed_count": included_count,
                }
            )
            continue

        marked_viewed = Content.objects.filter(
            id__in=content_ids,
            viewed=False,
        ).update(viewed=True)
        summary["sent_users"] += 1
        summary["items_sent"] += included_count
        summary["marked_viewed"] += marked_viewed
        summary["user_results"].append(
            {
                "user_id": user_id,
                "recipient": recipient,
                "sent": True,
                "count": total_count,
                "displayed_count": included_count,
                "marked_viewed": marked_viewed,
            }
        )

    return summary
