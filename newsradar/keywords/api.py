from datetime import datetime
import uuid

from django.db.models import Count, Max, Q
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from newsradar.content.models import ContentSource
from newsradar.keywords.models import Keyword, normalize_keyword_query

api = NinjaAPI(title="Keywords API", urls_namespace="keywords")


class ContentSourceItem(Schema):
    id: int
    url: str
    title: str
    content_item_count: int
    last_seen: datetime | None


class KeywordContentSourcesResponse(Schema):
    keyword_uuid: uuid.UUID
    query: str
    sources: list[ContentSourceItem]


class KeywordListItem(Schema):
    id: int
    uuid: uuid.UUID
    text: str
    query: str
    last_fetched_at: datetime | None
    content_source_count: int


class KeywordListResponse(Schema):
    keywords: list[KeywordListItem]


class KeywordCreateRequest(Schema):
    text: str


class KeywordCreateResponse(Schema):
    keyword: KeywordListItem


@api.get("/", response=KeywordListResponse)
def list_keywords(request, search: str | None = None):
    keyword_filter = Q()
    if search:
        keyword_filter = Q(text__icontains=search) | Q(query__icontains=search)

    keywords = (
        Keyword.objects.filter(keyword_filter)
        .annotate(
            content_source_count=Count(
                "content_items__source_links__content_source",
                distinct=True,
            )
        )
        .order_by("-last_fetched_at", "-created_at", "query")
    )

    return KeywordListResponse(
        keywords=[
            KeywordListItem(
                id=keyword.id,
                uuid=keyword.uuid,
                text=keyword.text,
                query=keyword.query,
                last_fetched_at=keyword.last_fetched_at,
                content_source_count=keyword.content_source_count,
            )
            for keyword in keywords
        ]
    )


@api.post("/", response=KeywordCreateResponse)
def create_keyword(request, payload: KeywordCreateRequest):
    normalized_text = normalize_keyword_query(payload.text)
    if not normalized_text:
        raise HttpError(400, "Keyword text cannot be empty.")
    keyword = Keyword.objects.create(text=payload.text)

    return KeywordCreateResponse(
        keyword=KeywordListItem(
            id=keyword.id,
            uuid=keyword.uuid,
            text=keyword.text,
            query=keyword.query,
            last_fetched_at=keyword.last_fetched_at,
            content_source_count=0,
        )
    )


@api.get("/{keyword_uuid}/sources", response=KeywordContentSourcesResponse)
def list_keyword_content_sources(request, keyword_uuid: uuid.UUID):
    keyword = Keyword.objects.filter(uuid=keyword_uuid).first()
    if not keyword:
        raise HttpError(404, "Keyword not found for UUID.")

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
        keyword_uuid=keyword.uuid,
        query=keyword.query,
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
