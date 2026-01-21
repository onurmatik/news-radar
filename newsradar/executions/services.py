import uuid
from datetime import datetime
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from django.conf import settings
from django.utils.dateparse import parse_datetime
from django.utils import timezone
from perplexity import Perplexity

from newsradar.contents.models import Content
from newsradar.executions.models import Execution
from newsradar.topics.models import Topic


def _build_perplexity_search_payload(topic: Topic, query: str | list[str]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "query": query,
        "max_results": settings.WEB_SEARCH_MAX_RESULTS,
        "max_tokens": settings.WEB_SEARCH_MAX_TOKENS,
        "max_tokens_per_page": settings.WEB_SEARCH_MAX_TOKENS_PER_PAGE,
    }

    if topic.search_domain_allowlist:
        payload["search_domain_filter"] = topic.search_domain_allowlist
    if topic.search_domain_blocklist:
        payload["search_domain_filter_exclude"] = topic.search_domain_blocklist
    if topic.search_language_filter:
        payload["search_language_filter"] = topic.search_language_filter
    if topic.country:
        payload["country"] = topic.country
    if topic.search_after_date:
        payload["search_after_date"] = topic.search_after_date.strftime("%m/%d/%Y")
    if topic.search_before_date:
        payload["search_before_date"] = topic.search_before_date.strftime("%m/%d/%Y")
    if topic.last_updated_after_filter:
        payload["last_updated_after_filter"] = topic.last_updated_after_filter.strftime(
            "%m/%d/%Y"
        )
    if topic.last_updated_before_filter:
        payload["last_updated_before_filter"] = topic.last_updated_before_filter.strftime(
            "%m/%d/%Y"
        )

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
    """
    Returns list of:
      {"url": str, "title": str, "date": datetime|None,
       "last_updated": datetime|None, "snippet": str}
    """
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
        title = item.get("title") or ""
        date_value = extract_datetime(
            ("published_date", "published_at", "date", "published"),
            item,
        )
        last_updated_value = extract_datetime(
            ("last_updated", "updated_at", "last_update"),
            item,
        )
        snippet = extract_snippet(item)

        sources.append(
            {
                "url": _normalize_source_url(url),
                "title": title,
                "date": date_value,
                "last_updated": last_updated_value,
                "snippet": snippet,
            }
        )
    return sources


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

    queries = [query for query in (topic.queries or []) if query][:5]
    if not queries:
        raise ValueError("Topic queries are required for web search.")
    search_query: str | list[str] = queries[0] if len(queries) == 1 else queries

    if execution is None:
        execution = Execution.objects.create(
            topic=topic,
            initiator=initiator,
            status=Execution.Status.RUNNING,
        )
    try:
        payload = _build_perplexity_search_payload(topic, search_query)
        execution.request_payload = payload
        execution.save(update_fields=["request_payload"])

        client = Perplexity()
        response_obj = client.search.create(
            **payload,
        )

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
        content_items: list[Content] = []
        if content_sources:
            seen_entries: set[tuple[str, datetime | None, datetime | None]] = set()
            ordered_entries: list[dict] = []
            for src in content_sources:
                url = src["url"]
                date_value = src.get("date")
                last_updated = src.get("last_updated")
                entry_key = (url, date_value, last_updated)
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
                content_items = Content.objects.bulk_create(
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

        topic.last_fetched_at = timezone.now()
        topic.save(update_fields=["last_fetched_at"])

        return {
            "execution_id": execution.id,
            "content_item_id": content_items[0].id if content_items else None,
            "response": execution.response_payload,
        }
    except Exception as exc:
        execution.status = Execution.Status.FAILED
        execution.error_message = str(exc)
        execution.save(update_fields=["status", "error_message"])
        raise
