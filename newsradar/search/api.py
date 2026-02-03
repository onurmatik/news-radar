from datetime import datetime
from uuid import UUID

from django.db.models import Count, Exists, OuterRef, Q
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from newsradar.contents.models import Bookmark, Content
from newsradar.topics.models import Topic, normalize_topic_query

api = NinjaAPI(title="Search API", urls_namespace="search")


class TopicSearchItem(Schema):
    id: int
    uuid: UUID
    queries: list[str]
    last_fetched_at: datetime | None
    content_source_count: int
    is_active: bool
    group_uuid: UUID | None
    group_name: str | None


class ContentSearchItem(Schema):
    id: int
    url: str
    title: str
    summary: str
    source: str
    created_at: datetime
    published_at: datetime | None
    topic_uuid: UUID
    topic_queries: list[str]
    is_bookmarked: bool


class SearchResponse(Schema):
    user_topics: list[TopicSearchItem]
    public_topics: list[TopicSearchItem]
    user_contents: list[ContentSearchItem]
    public_contents: list[ContentSearchItem]


def _build_topic_search_filter(search: str) -> Q:
    normalized_search = normalize_topic_query(search)
    if not normalized_search:
        return Q()
    return Q(queries__contains=[normalized_search])


def _build_content_search_filter(search: str) -> Q:
    search_value = search.strip()
    if not search_value:
        return Q()
    return (
        Q(title__icontains=search_value)
        | Q(snippet__icontains=search_value)
        | Q(url__icontains=search_value)
    )


@api.get("/", response=SearchResponse)
def search(request, q: str | None = None, limit: int = 10, group_uuid: UUID | None = None):
    if not q or not q.strip():
        raise HttpError(400, "Search query is required.")
    limit = max(1, min(limit, 50))

    topic_filter = _build_topic_search_filter(q)
    content_filter = _build_content_search_filter(q)

    user_topics: list[TopicSearchItem] = []
    user_contents: list[ContentSearchItem] = []
    public_topics: list[TopicSearchItem] = []
    public_contents: list[ContentSearchItem] = []

    if request.user.is_authenticated:
        topic_queryset = Topic.objects.filter(topic_filter, user=request.user)
        if group_uuid:
            topic_queryset = topic_queryset.filter(group__uuid=group_uuid)
        topic_queryset = (
            topic_queryset.select_related("group")
            .annotate(content_source_count=Count("executions__content_items", distinct=True))
            .order_by("-last_fetched_at", "-created_at", "uuid")[:limit]
        )

        user_topics = [
            TopicSearchItem(
                id=topic.id,
                uuid=topic.uuid,
                queries=topic.queries or [],
                last_fetched_at=topic.last_fetched_at,
                content_source_count=topic.content_source_count,
                is_active=topic.is_active,
                group_uuid=topic.group.uuid if topic.group else None,
                group_name=topic.group.name if topic.group else None,
            )
            for topic in topic_queryset
        ]

        content_queryset = Content.objects.filter(
            content_filter,
            execution__topic__user=request.user,
        )
        if group_uuid:
            content_queryset = content_queryset.filter(
                execution__topic__group__uuid=group_uuid
            )

        bookmark_subquery = Bookmark.objects.filter(
            user=request.user,
            content_id=OuterRef("pk"),
        )
        content_queryset = (
            content_queryset.select_related("execution", "execution__topic")
            .annotate(is_bookmarked=Exists(bookmark_subquery))
            .order_by("-created_at", "-id")[:limit]
        )

        user_contents = [
            ContentSearchItem(
                id=content.id,
                url=content.url,
                title=content.title or "",
                summary=(content.snippet or "").strip(),
                source=content.normalized_domain(),
                created_at=content.created_at,
                published_at=content.date or content.last_updated or content.created_at,
                topic_uuid=content.execution.topic.uuid,
                topic_queries=content.execution.topic.queries or [],
                is_bookmarked=bool(getattr(content, "is_bookmarked", False)),
            )
            for content in content_queryset
        ]

    public_group_filter = Q(group__is_public=True)
    if group_uuid:
        public_group_filter &= Q(group__uuid=group_uuid)

    public_topics_queryset = (
        Topic.objects.filter(topic_filter, public_group_filter, is_active=True)
        .select_related("group")
        .annotate(content_source_count=Count("executions__content_items", distinct=True))
        .order_by("-last_fetched_at", "-created_at", "uuid")[:limit]
    )

    public_topics = [
        TopicSearchItem(
            id=topic.id,
            uuid=topic.uuid,
            queries=topic.queries or [],
            last_fetched_at=topic.last_fetched_at,
            content_source_count=topic.content_source_count,
            is_active=topic.is_active,
            group_uuid=topic.group.uuid if topic.group else None,
            group_name=topic.group.name if topic.group else None,
        )
        for topic in public_topics_queryset
    ]

    public_contents_queryset = Content.objects.filter(
        content_filter,
        execution__topic__group__is_public=True,
        execution__topic__is_active=True,
    )
    if group_uuid:
        public_contents_queryset = public_contents_queryset.filter(
            execution__topic__group__uuid=group_uuid
        )

    public_contents_queryset = (
        public_contents_queryset.select_related("execution", "execution__topic")
        .order_by("-created_at", "-id")[:limit]
    )

    public_contents = [
        ContentSearchItem(
            id=content.id,
            url=content.url,
            title=content.title or "",
            summary=(content.snippet or "").strip(),
            source=content.normalized_domain(),
            created_at=content.created_at,
            published_at=content.date or content.last_updated or content.created_at,
            topic_uuid=content.execution.topic.uuid,
            topic_queries=content.execution.topic.queries or [],
            is_bookmarked=False,
        )
        for content in public_contents_queryset
    ]

    return SearchResponse(
        user_topics=user_topics,
        public_topics=public_topics,
        user_contents=user_contents,
        public_contents=public_contents,
    )
