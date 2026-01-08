from urllib.parse import urlparse, urlunparse

from django.utils import timezone
from openai import OpenAI

from newsradar.agenda.models import (
    ContentItem,
    ContentItemSource,
    ContentMatch,
    ContentSource,
)
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
    order_index = 0
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
                    "order_index": order_index,
                }
            )
            order_index += 1

    return sources


def execute_web_search(normalized_keyword: str) -> dict:
    normalized_keyword = normalize_keyword_text(normalized_keyword)
    keyword = Keyword.objects.filter(normalized_text=normalized_keyword).first()
    if not keyword:
        raise ValueError("Keyword not found for normalized text.")

    prompt = (
        "Use web search to find the latest, up-to-date information for this keyword: "
        f"{normalized_keyword}"
    )

    client = OpenAI()
    response = client.responses.create(
        model="gpt-5-nano",
        tools=[{"type": "web_search"}],
        input=prompt,
    )

    response_payload = response.model_dump()
    content_item = ContentItem.objects.create(
        content={
            "keyword": normalized_keyword,
            "query": prompt,
            "response": response_payload,
            "output_text": response.output_text,
        }
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
                    order_index=unique_sources[url]["order_index"],
                )
                for url in urls
            ],
            ignore_conflicts=True,
        )

    content_match = ContentMatch.objects.create(
        keyword=keyword,
        content_item=content_item,
        match_score=1.0,
    )

    keyword.last_fetched_at = timezone.now()
    keyword.save(update_fields=["last_fetched_at"])

    return {
        "content_item_id": content_item.id,
        "content_match_id": content_match.id,
        "output_text": response.output_text,
        "response": response_payload,
    }
