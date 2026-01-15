import uuid
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from django.conf import settings
from django.utils import timezone
from perplexity import Perplexity

from newsradar.contents.models import Content
from newsradar.executions.models import Execution
from newsradar.topics.models import Topic


def _build_perplexity_search_payload(topic: Topic, prompt: str) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "query": prompt,
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
    if topic.search_recency_filter:
        payload["search_recency_filter"] = topic.search_recency_filter
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
      {"url": str, "title": str, "metadata": dict|None}
    """
    if not response_payload:
        return []

    results = response_payload.get("results") or []
    if not isinstance(results, list) or not results:
        return []

    sources: list[dict] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        url = item.get("url")
        if not url:
            continue
        title = item.get("title") or ""
        metadata = {"provider": "perplexity"}
        for k, v in item.items():
            if k in {"url", "title"}:
                continue
            metadata[k] = v

        sources.append(
            {
                "url": _normalize_source_url(url),
                "title": title,
                "metadata": metadata or None,
            }
        )
    return sources


def execute_web_search(
    topic_uuid: str | uuid.UUID,
    initiator: str = Execution.Initiator.USER,
) -> dict:
    if isinstance(topic_uuid, str):
        try:
            topic_uuid = uuid.UUID(topic_uuid)
        except ValueError as exc:
            raise ValueError("Invalid topic UUID.") from exc
    topic = Topic.objects.filter(uuid=topic_uuid).first()
    if not topic:
        raise ValueError("Topic not found for UUID.")

    prompt = (
        "Use web search to find the latest, up-to-date information for this topic: "
        f"{topic.primary_query}"
    )

    execution = Execution.objects.create(
        topic=topic,
        initiator=initiator,
        status=Execution.Status.RUNNING,
    )
    try:
        payload = _build_perplexity_search_payload(topic, prompt)
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
                "response_payload",
                "status",
                "error_message",
            ]
        )

        content_sources = _extract_content_sources(response_payload)
        content_items: list[Content] = []
        if content_sources:
            unique_by_url: dict[str, dict] = {}
            ordered_urls: list[str] = []
            for src in content_sources:
                url = src["url"]
                if url in unique_by_url:
                    continue
                unique_by_url[url] = src
                ordered_urls.append(url)

            content_items = Content.objects.bulk_create(
                [
                    Content(
                        execution=execution,
                        url=url,
                        title=unique_by_url[url].get("title") or "",
                        metadata=unique_by_url[url].get("metadata"),
                    )
                    for url in ordered_urls
                ]
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
