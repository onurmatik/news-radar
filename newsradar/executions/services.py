import uuid
import json
import logging
from datetime import datetime
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from django.conf import settings
from django.utils.dateparse import parse_datetime
from django.utils import timezone
from openai import OpenAI
from perplexity import Perplexity

from newsradar.contents.models import Content
from newsradar.executions.models import Execution
from newsradar.topics.models import Topic, normalize_topic_query
from newsradar.topics.services import normalize_domain_value

logger = logging.getLogger(__name__)


def _paused_group_error_message(topic: Topic) -> str:
    if topic.group and topic.group.name:
        return f'Scanning is paused for topic group "{topic.group.name}".'
    return "Scanning is paused for this topic group."


def _mark_execution_failed(execution: Execution, message: str) -> None:
    execution.status = Execution.Status.FAILED
    execution.error_message = message
    execution.save(update_fields=["status", "error_message"])


def _build_search_domain_filter(topic: Topic) -> list[str] | None:
    allowlist = [
        domain
        for entry in (topic.search_domain_allowlist or [])
        if (domain := normalize_domain_value(entry))
    ]
    blocklist = [
        domain
        for entry in (topic.search_domain_blocklist or [])
        if (domain := normalize_domain_value(entry))
    ]


    if allowlist:
        return allowlist
    if blocklist:
        return [
            domain if domain.startswith("-") else f"-{domain}"
            for domain in blocklist
        ]
    return None


def _build_perplexity_search_payload(topic: Topic, query: str | list[str]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "query": query,
        "max_results": settings.WEB_SEARCH_MAX_RESULTS,
        "max_tokens": settings.WEB_SEARCH_MAX_TOKENS,
        "max_tokens_per_page": settings.WEB_SEARCH_MAX_TOKENS_PER_PAGE,
    }

    search_domain_filter = _build_search_domain_filter(topic)
    if search_domain_filter:
        payload["search_domain_filter"] = search_domain_filter
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


def _parse_json_from_text(text: str) -> Any:
    stripped = (text or "").strip()
    if not stripped:
        return None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass

    for start_char, end_char in (("{", "}"), ("[", "]")):
        start = stripped.find(start_char)
        end = stripped.rfind(end_char)
        if start == -1 or end == -1 or end <= start:
            continue
        candidate = stripped[start : end + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    return None


def _normalize_generated_queries(raw_values: Any, primary_query: str) -> list[str]:
    if not isinstance(raw_values, list):
        return []
    normalized_primary = normalize_topic_query(primary_query)
    seen: set[str] = set()
    normalized_queries: list[str] = []
    for item in raw_values:
        if not isinstance(item, str):
            continue
        cleaned = normalize_topic_query(item)
        if not cleaned:
            continue
        if cleaned == normalized_primary or cleaned in seen:
            continue
        seen.add(cleaned)
        normalized_queries.append(cleaned)
    return normalized_queries[:4]


def _generate_auto_additional_queries(topic: Topic, primary_query: str) -> list[str]:
    if not settings.OPENAI_API_KEY:
        return []

    agenda_parts = [f"Primary topic: {primary_query}"]
    if topic.group:
        agenda_parts.append(f"Agenda group: {topic.group.name}")
        if topic.group.description:
            agenda_parts.append(f"Agenda notes: {topic.group.description}")
    if topic.country:
        agenda_parts.append(f"Country focus: {topic.country}")
    if topic.search_language_filter:
        agenda_parts.append(
            "Language focus: " + ", ".join(topic.search_language_filter)
        )

    prompt = (
        "Generate 2-4 additional web search queries for a news-monitoring agenda. "
        "Return strict JSON only, in this format: "
        '{"queries":["query 1","query 2"]}. '
        "Keep queries short, concrete, and complementary to the primary topic.\n\n"
        + "\n".join(agenda_parts)
    )

    try:
        client = OpenAI(timeout=settings.OPENAI_RESPONSES_TIMEOUT_SECONDS)
        response_request_kwargs: dict[str, Any] = dict(
            model=settings.OPENAI_RESPONSES_MODEL,
            input=prompt,
            max_output_tokens=200,
        )
        if settings.OPENAI_RESPONSES_REASONING_EFFORT is not None:
            response_request_kwargs["reasoning"] = {
                "effort": settings.OPENAI_RESPONSES_REASONING_EFFORT,
            }
        response = client.responses.create(**response_request_kwargs)
        parsed = _parse_json_from_text(getattr(response, "output_text", ""))
        if isinstance(parsed, dict):
            return _normalize_generated_queries(parsed.get("queries"), primary_query)
        return _normalize_generated_queries(parsed, primary_query)
    except Exception:
        logger.exception("Failed to generate auto additional queries for topic %s", topic.uuid)
        return []


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
    topic = Topic.objects.select_related("group").filter(uuid=topic_uuid).first()
    if not topic:
        raise ValueError("Topic not found for UUID.")

    execution = None
    if execution_id is not None:
        execution = Execution.objects.filter(id=execution_id).first()
        if not execution:
            raise ValueError("Execution not found.")
        if execution.topic_id != topic.id:
            raise ValueError("Execution does not match topic.")

    if topic.group and topic.group.is_paused:
        message = _paused_group_error_message(topic)
        if execution is not None:
            _mark_execution_failed(execution, message)
        raise ValueError(message)

    queries = [query for query in (topic.queries or []) if query][:5]
    if not queries:
        raise ValueError("Topic queries are required for web search.")

    if topic.additional_queries_mode == Topic.ADDITIONAL_QUERIES_MODE_AUTO:
        primary_query = queries[0]
        auto_queries = _generate_auto_additional_queries(topic, primary_query)
        queries = [primary_query, *auto_queries][:5]

    search_query: str | list[str] = queries[0] if len(queries) == 1 else queries

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
        latest_content_item_id: int | None = None
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

        return {
            "execution_id": execution.id,
            "content_item_id": latest_content_item_id,
            "response": execution.response_payload,
        }
    except Exception as exc:
        execution.status = Execution.Status.FAILED
        execution.error_message = str(exc)
        execution.save(update_fields=["status", "error_message"])
        raise
