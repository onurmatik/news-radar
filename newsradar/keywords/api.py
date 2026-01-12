from datetime import datetime

from django.db.models import Count, Max
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from newsradar.content.models import ContentSource
from newsradar.keywords.models import Keyword, normalize_keyword_text

api = NinjaAPI(title="Keywords API", urls_namespace="keywords")


class ContentSourceItem(Schema):
    id: int
    url: str
    title: str
    content_item_count: int
    last_seen: datetime | None


class KeywordContentSourcesResponse(Schema):
    keyword_id: int
    normalized_keyword: str
    sources: list[ContentSourceItem]


@api.get("/{keyword_text}/sources", response=KeywordContentSourcesResponse)
def list_keyword_content_sources(request, keyword_text: str):
    normalized_keyword = normalize_keyword_text(keyword_text)
    keyword = Keyword.objects.filter(normalized_text=normalized_keyword).first()
    if not keyword:
        raise HttpError(404, "Keyword not found for normalized text.")

    sources = (
        ContentSource.objects.filter(
            content_links__content_item__keyword=keyword,
        )
        .annotate(
            content_item_count=Count("content_links", distinct=True),
            last_seen=Max("content_links__content_item__created_at"),
        )
        .order_by("-last_seen", "url")
    )

    return KeywordContentSourcesResponse(
        keyword_id=keyword.id,
        normalized_keyword=normalized_keyword,
        sources=[
            ContentSourceItem(
                id=source.id,
                url=source.url,
                title=source.title,
                content_item_count=source.content_item_count,
                last_seen=source.last_seen,
            )
            for source in sources
        ],
    )
