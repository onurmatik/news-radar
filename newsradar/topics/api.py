from datetime import datetime
import uuid

from django.db.models import Count, Max, OuterRef, Q, Subquery
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from newsradar.contents.models import Content
from newsradar.topics.models import Topic, normalize_topic_query

api = NinjaAPI(title="Topics API", urls_namespace="topics")


class ContentSourceItem(Schema):
    id: int
    url: str
    title: str
    content_item_count: int
    last_seen: datetime | None


class TopicContentSourcesResponse(Schema):
    topic_uuid: uuid.UUID
    queries: list[str]
    sources: list[ContentSourceItem]


class TopicListItem(Schema):
    id: int
    uuid: uuid.UUID
    queries: list[str]
    last_fetched_at: datetime | None
    content_source_count: int


class TopicListResponse(Schema):
    topics: list[TopicListItem]


class TopicCreateRequest(Schema):
    queries: list[str]


class TopicCreateResponse(Schema):
    topic: TopicListItem


@api.get("/", response=TopicListResponse)
def list_topics(request, search: str | None = None):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    topic_filter = Q()
    if search:
        normalized_search = normalize_topic_query(search)
        if normalized_search:
            topic_filter = Q(queries__contains=[normalized_search])

    topics = (
        Topic.objects.filter(
            topic_filter,
            user=request.user,
        )
        .annotate(
            content_source_count=Count(
                "executions__content_items",
                distinct=True,
            )
        )
        .order_by("-last_fetched_at", "-created_at", "uuid")
    )

    return TopicListResponse(
        topics=[
            TopicListItem(
                id=topic.id,
                uuid=topic.uuid,
                queries=topic.queries or [],
                last_fetched_at=topic.last_fetched_at,
                content_source_count=topic.content_source_count,
            )
            for topic in topics
        ]
    )


@api.post("/", response=TopicCreateResponse)
def create_topic(request, payload: TopicCreateRequest):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    normalized_queries: list[str] = []
    seen = set()
    for item in payload.queries or []:
        if not isinstance(item, str):
            raise HttpError(400, "Topic queries must be strings.")
        normalized_item = normalize_topic_query(item)
        if not normalized_item or normalized_item in seen:
            continue
        seen.add(normalized_item)
        normalized_queries.append(normalized_item)
    if not normalized_queries:
        raise HttpError(400, "Topic queries cannot be empty.")
    topic = Topic.objects.create(
        user=request.user,
        queries=normalized_queries,
    )

    return TopicCreateResponse(
        topic=TopicListItem(
            id=topic.id,
            uuid=topic.uuid,
            queries=topic.queries or [],
            last_fetched_at=topic.last_fetched_at,
            content_source_count=0,
        )
    )


@api.get("/{topic_uuid}/sources", response=TopicContentSourcesResponse)
def list_topic_content_sources(request, topic_uuid: uuid.UUID):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    topic = Topic.objects.filter(
        uuid=topic_uuid,
        user=request.user,
    ).first()

    if not topic:
        raise HttpError(404, "Topic not found for UUID.")

    content_items = Content.objects.filter(execution__topic=topic)
    latest_for_url = content_items.filter(url=OuterRef("url")).order_by("-created_at", "-id")
    sources = (
        content_items.values("url")
        .annotate(
            content_item_count=Count("id"),
            last_seen=Max("created_at"),
            title=Subquery(latest_for_url.values("title")[:1]),
            source_id=Subquery(latest_for_url.values("id")[:1]),
        )
        .order_by("-last_seen", "url")
    )

    return TopicContentSourcesResponse(
        topic_uuid=topic.uuid,
        queries=topic.queries or [],
        sources=[
            ContentSourceItem(
                id=source["source_id"],
                url=source["url"],
                title=source.get("title") or "",
                content_item_count=source["content_item_count"],
                last_seen=source["last_seen"],
            )
            for source in sources
        ],
    )
