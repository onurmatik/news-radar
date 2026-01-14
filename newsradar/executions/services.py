import os
import uuid
from typing import Any
from urllib.parse import urlparse, urlunparse

from django.conf import settings
from django.utils import timezone
from openai import OpenAI
from perplexity import Perplexity

from newsradar.content.models import (
    ContentItem,
    ContentItemSource,
    ContentSource,
)
from newsradar.executions.models import Execution
from newsradar.keywords.models import Keyword


def _get_llm_provider(keyword: Keyword | None = None) -> str:
    provider = (
        getattr(keyword, "provider", None)
        or settings.WEB_SEARCH_PROVIDER
    )
    provider = str(provider).strip().lower()
    if provider not in settings.SUPPORTED_WEB_SEARCH_PROVIDERS:
        supported = ", ".join(sorted(settings.SUPPORTED_WEB_SEARCH_PROVIDERS))
        raise ValueError(
            f"Unsupported LLM provider '{provider}'. Supported providers: {supported}."
        )
    return provider


def _build_perplexity_search_payload(keyword: Keyword, prompt: str) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "query": prompt,
        "max_results": keyword.max_results,
        "max_tokens": keyword.max_tokens,
        "max_tokens_per_page": keyword.max_tokens_per_page,
    }

    if keyword.search_domain_allowlist:
        payload["search_domain_filter"] = keyword.search_domain_allowlist
    if keyword.search_domain_blocklist:
        payload["search_domain_filter_exclude"] = keyword.search_domain_blocklist
    if keyword.search_language_filter:
        payload["search_language_filter"] = keyword.search_language_filter
    if keyword.country:
        payload["country"] = keyword.country
    if keyword.search_recency_filter:
        payload["search_recency_filter"] = keyword.search_recency_filter
    if keyword.search_after_date:
        payload["search_after_date"] = keyword.search_after_date.strftime("%m/%d/%Y")
    if keyword.search_before_date:
        payload["search_before_date"] = keyword.search_before_date.strftime("%m/%d/%Y")
    if keyword.last_updated_after_filter:
        payload["last_updated_after_filter"] = keyword.last_updated_after_filter.strftime(
            "%m/%d/%Y"
        )
    if keyword.last_updated_before_filter:
        payload["last_updated_before_filter"] = keyword.last_updated_before_filter.strftime(
            "%m/%d/%Y"
        )

    if keyword.provider_config:
        payload.update(keyword.provider_config)

    return payload


def _normalize_source_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.query == "utm_source=openai":
        parsed = parsed._replace(query="")
    return urlunparse(parsed)


def _extract_content_sources(provider: str, response_payload: dict) -> list[dict]:
    """
    Returns list of:
      {"url": str, "title": str, "metadata": dict|None}
    """
    provider = (provider or "").strip().lower()
    if not response_payload:
        return []

    if provider == "openai":
        output_items = response_payload.get("output") or []
        if not output_items:
            return []

        message_output = next(
            (
                item
                for item in reversed(output_items)
                if item.get("type") == "message" and item.get("status") == "completed"
            ),
            None,
        )
        if not message_output:
            return []

        sources: list[dict] = []
        for content_item in (message_output.get("content") or []):
            annotations = content_item.get("annotations") or []
            for annotation in annotations:
                if annotation.get("type") != "url_citation":
                    continue
                url = annotation.get("url") or annotation.get("source_url")
                if not url:
                    continue
                title = annotation.get("title") or annotation.get("source_title") or ""
                metadata = {
                    "provider": "openai",
                }
                sources.append(
                    {
                        "url": _normalize_source_url(url),
                        "title": title,
                        "metadata": metadata,
                    }
                )
        return sources

    if provider == "perplexity":
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

    return []


def execute_web_search(
    keyword_uuid: str | uuid.UUID,
    origin_type: str = Execution.OriginType.USER,
) -> dict:
    if isinstance(keyword_uuid, str):
        try:
            keyword_uuid = uuid.UUID(keyword_uuid)
        except ValueError as exc:
            raise ValueError("Invalid keyword UUID.") from exc
    keyword = Keyword.objects.filter(uuid=keyword_uuid).first()
    if not keyword:
        raise ValueError("Keyword not found for UUID.")

    prompt = (
        "Use web search to find the latest, up-to-date information for this keyword: "
        f"{keyword.query}"
    )

    execution = Execution.objects.create(
        origin_type=origin_type,
        status=Execution.Status.RUNNING,
    )
    llm_config: dict[str, object] | None = None
    try:
        provider = _get_llm_provider(keyword)

        response_obj: Any
        if provider == "openai":
            model = os.getenv("OPENAI_WEB_SEARCH_MODEL", "gpt-5-nano")
            tools = [{"type": "web_search"}]
            llm_config = {
                "provider": provider,
                "model": model,
                "tools": tools,
                "input": prompt,
            }
            client = OpenAI()
            response_obj = client.responses.create(
                model=model,
                tools=tools,
                input=prompt,
            )

        elif provider == "perplexity":
            model = os.getenv("PERPLEXITY_WEB_SEARCH_MODEL", "sonar")
            payload = _build_perplexity_search_payload(keyword, prompt)
            llm_config = {
                "provider": provider,
                "model": model,
                "search_payload": payload,
            }
            client = Perplexity()
            response_obj = client.search.create(
                **payload,
            )
        else:
            raise ValueError(f"Unsupported LLM provider '{provider}'.")

        response_payload = response_obj.model_dump()

        content_item = ContentItem.objects.create(
            keyword=keyword,
        )
        execution.content_item = content_item
        execution.raw_data = response_payload
        execution.status = Execution.Status.COMPLETED
        execution.error_message = None
        execution.llm_config = llm_config
        execution.save(
            update_fields=[
                "content_item",
                "raw_data",
                "status",
                "error_message",
                "llm_config",
            ]
        )

        content_sources = _extract_content_sources(provider, response_payload)
        if content_sources:
            unique_by_url: dict[str, dict] = {}
            ordered_urls: list[str] = []
            for src in content_sources:
                url = src["url"]
                if url in unique_by_url:
                    continue
                unique_by_url[url] = src
                ordered_urls.append(url)

            urls = ordered_urls
            existing_sources = {
                source.url: source
                for source in ContentSource.objects.filter(url__in=urls)
            }
            new_sources = [
                ContentSource(
                    url=url,
                    title=unique_by_url[url].get("title") or "",
                    metadata=unique_by_url[url].get("metadata"),
                )
                for url in urls
                if url not in existing_sources
            ]
            if new_sources:
                ContentSource.objects.bulk_create(new_sources, ignore_conflicts=True)
                existing_sources = {
                    source.url: source
                    for source in ContentSource.objects.filter(url__in=urls)
                }
            ContentItemSource.objects.bulk_create(
                [
                    ContentItemSource(
                        content_item=content_item,
                        content_source=existing_sources[url],
                    )
                    for url in urls
                    if url in existing_sources
                ],
                ignore_conflicts=True,
            )

        keyword.last_fetched_at = timezone.now()
        keyword.save(update_fields=["last_fetched_at"])

        return {
            "execution_id": execution.id,
            "content_item_id": content_item.id,
            "response": execution.raw_data,
        }
    except Exception as exc:
        execution.status = Execution.Status.FAILED
        execution.error_message = str(exc)
        if llm_config is not None:
            execution.llm_config = llm_config
            execution.save(
                update_fields=["status", "error_message", "llm_config"]
            )
        else:
            execution.save(update_fields=["status", "error_message"])
        raise
