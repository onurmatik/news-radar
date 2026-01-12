import os
from urllib.parse import urlparse, urlunparse

from django.utils import timezone
from openai import OpenAI

from newsradar.content.models import (
    ContentItem,
    ContentItemSource,
    ContentSource,
)
from newsradar.executions.models import Execution
from newsradar.keywords.models import Keyword, normalize_keyword_text


def _normalize_source_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.query == "utm_source=openai":
        parsed = parsed._replace(query="")
    return urlunparse(parsed)


def _extract_content_sources(response_payload: dict) -> list[dict]:
    if not response_payload:
        return []
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

    sources = []
    for content_item in message_output.get("content") or []:
        annotations = content_item.get("annotations") or []
        for annotation in annotations:
            if annotation.get("type") != "url_citation":
                continue
            url = annotation.get("url") or annotation.get("source_url")
            if not url:
                continue
            sources.append(
                {
                    "url": _normalize_source_url(url),
                    "title": annotation.get("title") or annotation.get("source_title") or "",
                }
            )

    return sources


SUPPORTED_LLM_PROVIDERS = {"openai"}


def _get_llm_provider() -> str:
    provider = os.getenv("LLM_PROVIDER", "openai").strip().lower()
    if provider not in SUPPORTED_LLM_PROVIDERS:
        supported = ", ".join(sorted(SUPPORTED_LLM_PROVIDERS))
        raise ValueError(
            f"Unsupported LLM provider '{provider}'. Supported providers: {supported}."
        )
    return provider


def execute_web_search(
    normalized_keyword: str,
    origin_type: str = Execution.OriginType.USER,
) -> dict:
    normalized_keyword = normalize_keyword_text(normalized_keyword)
    keyword = Keyword.objects.filter(normalized_text=normalized_keyword).first()
    if not keyword:
        raise ValueError("Keyword not found for normalized text.")

    prompt = (
        "Use web search to find the latest, up-to-date information for this keyword: "
        f"{normalized_keyword}"
    )

    execution = Execution.objects.create(
        origin_type=origin_type,
        status=Execution.Status.RUNNING,
    )
    llm_config: dict[str, object] | None = None
    try:
        provider = _get_llm_provider()
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
            response = client.responses.create(
                model=model,
                tools=tools,
                input=prompt,
            )
        else:
            raise ValueError(f"Unsupported LLM provider '{provider}'.")

        response_payload = response.model_dump()
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

        content_sources = _extract_content_sources(response_payload)
        if content_sources:
            unique_sources = {}
            ordered_urls = []
            for source in content_sources:
                url = source["url"]
                if url in unique_sources:
                    continue
                unique_sources[url] = source
                ordered_urls.append(url)

            urls = ordered_urls
            existing_sources = {
                source.url: source
                for source in ContentSource.objects.filter(url__in=urls)
            }
            new_sources = [
                ContentSource(url=url, title=unique_sources[url]["title"])
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
