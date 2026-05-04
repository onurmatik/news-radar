import logging
import math
import uuid
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from django.conf import settings
from django.db.models import Count
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from perplexity import Perplexity

from newsradar.contents.models import Content
from newsradar.executions.models import Execution
from newsradar.topics.models import Topic, normalize_topic_query
from newsradar.topics.services import normalize_domain_value, normalize_string_list

logger = logging.getLogger(__name__)


def _normalize_search_domain_filter(values: list[str] | None) -> list[str] | None:
    allowlist = [
        domain
        for entry in (values or [])
        if (domain := normalize_domain_value(entry))
    ]
    return allowlist or None


def _build_perplexity_search_payload(
    *,
    query: str | list[str],
    search_domain_allowlist: list[str] | None = None,
    search_language_filter: list[str] | None = None,
    country: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "query": query,
        "max_results": settings.WEB_SEARCH_MAX_RESULTS,
        "max_tokens": settings.WEB_SEARCH_MAX_TOKENS,
        "max_tokens_per_page": settings.WEB_SEARCH_MAX_TOKENS_PER_PAGE,
    }

    search_domain_filter = _normalize_search_domain_filter(search_domain_allowlist)
    if search_domain_filter:
        payload["search_domain_filter"] = search_domain_filter
    if search_language_filter:
        payload["search_language_filter"] = search_language_filter
    if country:
        payload["country"] = normalize_topic_query(country).upper()

    return payload


def _normalize_source_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.query:
        query_items = [
            (key, value)
            for key, value in parse_qsl(parsed.query, keep_blank_values=True)
            if key != "utm_source"
        ]
        parsed = parsed._replace(query=urlencode(query_items))
    return urlunparse(parsed)


def _extract_content_sources(response_payload: dict) -> list[dict]:
    if not response_payload:
        return []

    results = response_payload.get("results") or []
    if not isinstance(results, list) or not results:
        return []

    sources: list[dict] = []

    def extract_datetime(keys: tuple[str, ...], source: dict) -> datetime | None:
        for key in keys:
            value = source.get(key)
            if isinstance(value, datetime):
                return value
            if isinstance(value, str):
                parsed = parse_datetime(value)
                if parsed:
                    return parsed
        return None

    def extract_snippet(source: dict) -> str:
        for key in ("snippet", "description", "content", "summary"):
            value = source.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ""

    for item in results:
        if not isinstance(item, dict):
            continue
        url = item.get("url")
        if not url:
            continue
        sources.append(
            {
                "url": _normalize_source_url(url),
                "title": item.get("title") or "",
                "date": extract_datetime(
                    ("published_date", "published_at", "date", "published"),
                    item,
                ),
                "last_updated": extract_datetime(
                    ("last_updated", "updated_at", "last_update"),
                    item,
                ),
                "snippet": extract_snippet(item),
            }
        )
    return sources


def _extract_preview_items(response_payload: dict) -> list[dict[str, Any]]:
    preview_items: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for item in _extract_content_sources(response_payload):
        url = item["url"]
        if url in seen_urls:
            continue
        seen_urls.add(url)
        preview_items.append(
            {
                "url": url,
                "title": item.get("title") or url,
                "snippet": item.get("snippet") or "",
                "domain": normalize_domain_value(url) or "",
                "published_at": item.get("date") or item.get("last_updated"),
            }
        )
    return preview_items


def _normalize_preview_queries(queries: list[str] | None) -> list[str]:
    normalized_queries = normalize_string_list(queries, max_length=5)
    if not normalized_queries:
        raise ValueError("At least one query is required.")
    return normalized_queries


def _build_search_query(queries: list[str]) -> str | list[str]:
    return queries[0] if len(queries) == 1 else queries


def _count_new_items_for_execution(execution: Execution) -> int:
    return int(execution.content_items.count())


def _round_interval_hours(value: float) -> int:
    return max(1, int(math.floor(value + 0.5)))


def _recalculate_auto_interval(topic: Topic) -> None:
    if topic.update_frequency != Topic.UPDATE_FREQUENCY_AUTO:
        return

    current = int(topic.auto_effective_interval_hours or 24)
    recent_counts = list(
        topic.executions.filter(status=Execution.Status.COMPLETED)
        .annotate(new_item_count=Count("content_items"))
        .order_by("-created_at")
        .values_list("new_item_count", flat=True)[:3]
    )
    if len(recent_counts) >= 2 and all(count >= 3 for count in recent_counts[:2]):
        next_interval = _round_interval_hours(current / 2)
    elif len(recent_counts) >= 3 and all(count == 0 for count in recent_counts[:3]):
        next_interval = _round_interval_hours(current * 2)
    else:
        next_interval = current

    next_interval = max(1, min(168, next_interval))
    if (
        next_interval != topic.auto_effective_interval_hours
        or topic.auto_interval_updated_at is None
    ):
        topic.auto_effective_interval_hours = next_interval
        topic.auto_interval_updated_at = timezone.now()
        topic.save(update_fields=["auto_effective_interval_hours", "auto_interval_updated_at"])


def topic_schedule_interval_hours(topic: Topic) -> int | None:
    mapping = {
        Topic.UPDATE_FREQUENCY_HOUR: 1,
        Topic.UPDATE_FREQUENCY_DAY: 24,
        Topic.UPDATE_FREQUENCY_WEEK: 168,
    }
    if topic.update_frequency == Topic.UPDATE_FREQUENCY_AUTO:
        return int(topic.auto_effective_interval_hours or 24)
    return mapping.get(topic.update_frequency)


def topic_is_due(topic: Topic, *, now: datetime | None = None) -> bool:
    interval_hours = topic_schedule_interval_hours(topic)
    if interval_hours is None:
        return False
    reference_now = now or timezone.now()
    if topic.last_fetched_at is None:
        return True
    return topic.last_fetched_at <= reference_now - timedelta(hours=interval_hours)


def preview_web_search(
    *,
    queries: list[str] | None,
    search_domain_allowlist: list[str] | None = None,
    search_language_filter: list[str] | None = None,
    country: str | None = None,
) -> dict[str, Any]:
    normalized_queries = _normalize_preview_queries(queries)
    payload = _build_perplexity_search_payload(
        query=_build_search_query(normalized_queries),
        search_domain_allowlist=search_domain_allowlist,
        search_language_filter=normalize_string_list(
            search_language_filter,
            lower=True,
            max_length=10,
        )
        or None,
        country=country,
    )
    client = Perplexity()
    response_payload = client.search.create(**payload).model_dump()
    return {
        "request_payload": payload,
        "response": response_payload,
        "items": _extract_preview_items(response_payload),
    }


def execute_web_search(
    topic_uuid: str | uuid.UUID,
    initiator: str = Execution.Initiator.USER,
    execution_id: int | None = None,
) -> dict:
    if isinstance(topic_uuid, str):
        try:
            topic_uuid = uuid.UUID(topic_uuid)
        except ValueError as exc:
            raise ValueError("Invalid topic UUID.") from exc
    topic = Topic.objects.filter(uuid=topic_uuid).first()
    if not topic:
        raise ValueError("Topic not found for UUID.")

    execution = None
    if execution_id is not None:
        execution = Execution.objects.filter(id=execution_id).first()
        if not execution:
            raise ValueError("Execution not found.")
        if execution.topic_id != topic.id:
            raise ValueError("Execution does not match topic.")

    queries = _normalize_preview_queries(topic.queries or [])

    if execution is None:
        execution = Execution.objects.create(
            topic=topic,
            initiator=initiator,
            status=Execution.Status.RUNNING,
        )
    elif execution.status != Execution.Status.RUNNING:
        execution.status = Execution.Status.RUNNING
        execution.error_message = None
        execution.save(update_fields=["status", "error_message"])

    try:
        payload = _build_perplexity_search_payload(
            query=_build_search_query(queries),
            search_domain_allowlist=topic.search_domain_allowlist,
            search_language_filter=topic.search_language_filter,
            country=topic.country,
        )
        execution.request_payload = payload
        execution.save(update_fields=["request_payload"])

        client = Perplexity()
        response_obj = client.search.create(**payload)
        response_payload = response_obj.model_dump()

        execution.response_payload = response_payload
        execution.status = Execution.Status.COMPLETED
        execution.error_message = None
        execution.save(
            update_fields=[
                "request_payload",
                "response_payload",
                "status",
                "error_message",
            ]
        )

        content_sources = _extract_content_sources(response_payload)
        latest_content_item_id: int | None = None
        if content_sources:
            seen_entries: set[tuple[str, datetime | None, datetime | None]] = set()
            ordered_entries: list[dict] = []
            for src in content_sources:
                entry_key = (src["url"], src.get("date"), src.get("last_updated"))
                if entry_key in seen_entries:
                    continue
                seen_entries.add(entry_key)
                ordered_entries.append(src)

            urls = {entry["url"] for entry in ordered_entries}
            existing_entries = set(
                Content.objects.filter(url__in=urls, topic=topic).values_list(
                    "url",
                    "date",
                    "last_updated",
                )
            )
            new_entries = [
                entry
                for entry in ordered_entries
                if (entry["url"], entry.get("date"), entry.get("last_updated"))
                not in existing_entries
            ]
            if new_entries:
                Content.objects.bulk_create(
                    [
                        Content(
                            execution=execution,
                            topic=topic,
                            url=entry["url"],
                            title=entry.get("title") or "",
                            date=entry.get("date"),
                            last_updated=entry.get("last_updated"),
                            snippet=entry.get("snippet"),
                        )
                        for entry in new_entries
                    ],
                    ignore_conflicts=True,
                )
                latest_content_item_id = (
                    Content.objects.filter(execution=execution)
                    .order_by("-created_at", "-id")
                    .values_list("id", flat=True)
                    .first()
                )

        topic.last_fetched_at = timezone.now()
        topic.save(update_fields=["last_fetched_at"])
        _recalculate_auto_interval(topic)

        return {
            "execution_id": execution.id,
            "content_item_id": latest_content_item_id,
            "new_item_count": _count_new_items_for_execution(execution),
            "response": execution.response_payload,
        }
    except Exception as exc:
        execution.status = Execution.Status.FAILED
        execution.error_message = str(exc)
        execution.save(update_fields=["status", "error_message"])
        raise
