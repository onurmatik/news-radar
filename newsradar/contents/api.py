from datetime import datetime, timezone as dt_timezone
from email.utils import format_datetime
from uuid import UUID
from xml.sax.saxutils import escape
from django.db.models import Exists, OuterRef
from django.http import HttpResponse
from django.utils import timezone
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from newsradar.contents.models import Bookmark, Content
from newsradar.topics.models import Topic, TopicGroup

api = NinjaAPI(title="Contents API", urls_namespace="contents")


def _format_rss_datetime(value: datetime | None) -> str:
    if value is None:
        return ""
    if timezone.is_naive(value):
        value = timezone.make_aware(value, dt_timezone.utc)
    return format_datetime(value)


def _build_rss_feed(
    *,
    title: str,
    link: str,
    description: str,
    contents: list[Content],
) -> str:
    items = []
    for content in contents:
        item_title = content.title or content.url
        item_link = content.url
        item_description = (content.snippet or "").strip()
        published_at = content.date or content.last_updated or content.created_at
        pub_date = _format_rss_datetime(published_at)
        pub_date_xml = f"<pubDate>{escape(pub_date)}</pubDate>" if pub_date else ""
        items.append(
            "<item>"
            f"<title>{escape(item_title)}</title>"
            f"<link>{escape(item_link)}</link>"
            f"<guid isPermaLink=\"true\">{escape(item_link)}</guid>"
            f"<description>{escape(item_description)}</description>"
            f"{pub_date_xml}"
            "</item>"
        )

    return (
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        "<rss version=\"2.0\">"
        "<channel>"
        f"<title>{escape(title)}</title>"
        f"<link>{escape(link)}</link>"
        f"<description>{escape(description)}</description>"
        f"{''.join(items)}"
        "</channel>"
        "</rss>"
    )


class ContentFeedItem(Schema):
    id: int
    url: str
    title: str
    summary: str
    source: str
    created_at: datetime
    published_at: datetime | None
    topic_uuid: UUID
    topic_queries: list[str]
    relevance_score: float | None
    is_bookmarked: bool


class ContentDetailItem(Schema):
    id: int
    url: str
    title: str
    summary: str
    content: str
    source: str
    created_at: datetime
    published_at: datetime | None
    topic_uuid: UUID
    topic_queries: list[str]
    relevance_score: float | None
    is_bookmarked: bool


class ContentFeedResponse(Schema):
    items: list[ContentFeedItem]


class BookmarkItem(Schema):
    id: int
    content_id: int
    url: str
    title: str
    created_at: datetime
    topic_uuid: UUID
    topic_queries: list[str]


class BookmarkListResponse(Schema):
    bookmarks: list[BookmarkItem]


class BookmarkCreateRequest(Schema):
    content_id: int


class BookmarkCreateResponse(Schema):
    bookmark: BookmarkItem
    created: bool


class BookmarkDeleteResponse(Schema):
    deleted: bool


@api.get("/items/{content_id}", response=ContentFeedItem)
def get_content_item(request, content_id: int):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")

    bookmark_subquery = Bookmark.objects.filter(
        user=request.user,
        content_id=OuterRef("pk"),
    )

    content = (
        Content.objects.filter(
            id=content_id,
            execution__topic__user=request.user,
        )
        .select_related("execution", "execution__topic")
        .annotate(is_bookmarked=Exists(bookmark_subquery))
        .first()
    )
    if not content:
        raise HttpError(404, "Content not found.")

    return ContentFeedItem(
        id=content.id,
        url=content.url,
        title=content.title or "",
        summary=(content.snippet or "").strip(),
        source=content.normalized_domain(),
        created_at=content.created_at,
        published_at=content.date or content.last_updated or content.created_at,
        topic_uuid=content.execution.topic.uuid,
        topic_queries=content.execution.topic.queries or [],
        relevance_score=None,
        is_bookmarked=bool(getattr(content, "is_bookmarked", False)),
    )


@api.get("/items/{content_id}/detail", response=ContentDetailItem)
def get_content_detail(request, content_id: int):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")

    bookmark_subquery = Bookmark.objects.filter(
        user=request.user,
        content_id=OuterRef("pk"),
    )

    content = (
        Content.objects.filter(
            id=content_id,
            execution__topic__user=request.user,
        )
        .select_related("execution", "execution__topic")
        .annotate(is_bookmarked=Exists(bookmark_subquery))
        .first()
    )
    if not content:
        raise HttpError(404, "Content not found.")

    return ContentDetailItem(
        id=content.id,
        url=content.url,
        title=content.title or "",
        summary=(content.snippet or "").strip(),
        content=(content.snippet or "").strip(),
        source=content.normalized_domain(),
        created_at=content.created_at,
        published_at=content.date or content.last_updated or content.created_at,
        topic_uuid=content.execution.topic.uuid,
        topic_queries=content.execution.topic.queries or [],
        relevance_score=None,
        is_bookmarked=bool(getattr(content, "is_bookmarked", False)),
    )


@api.get("/", response=ContentFeedResponse)
def list_content(
    request,
    topic_uuid: UUID | None = None,
    limit: int = 50,
    offset: int = 0,
):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    queryset = Content.objects.filter(execution__topic__user=request.user)
    if topic_uuid:
        queryset = queryset.filter(execution__topic__uuid=topic_uuid)

    bookmark_subquery = Bookmark.objects.filter(
        user=request.user,
        content_id=OuterRef("pk"),
    )

    contents = (
        queryset.select_related("execution", "execution__topic")
        .annotate(is_bookmarked=Exists(bookmark_subquery))
        .order_by("-created_at", "-id")[offset : offset + limit]
    )

    return ContentFeedResponse(
        items=[
            ContentFeedItem(
                id=content.id,
                url=content.url,
                title=content.title or "",
                summary=(content.snippet or "").strip(),
                source=content.normalized_domain(),
                created_at=content.created_at,
                published_at=content.date or content.last_updated or content.created_at,
                topic_uuid=content.execution.topic.uuid,
                topic_queries=content.execution.topic.queries or [],
                relevance_score=None,
                is_bookmarked=bool(getattr(content, "is_bookmarked", False)),
            )
            for content in contents
        ]
    )


@api.get("/topics/{topic_uuid}", response=ContentFeedResponse)
def list_content_by_topic(
    request,
    topic_uuid: UUID,
    limit: int = 50,
    offset: int = 0,
):
    return list_content(
        request,
        topic_uuid=topic_uuid,
        limit=limit,
        offset=offset,
    )


@api.get("/topics/{topic_uuid}/rss")
def list_content_by_topic_rss(
    request,
    topic_uuid: UUID,
    limit: int = 50,
    offset: int = 0,
):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    topic = Topic.objects.filter(uuid=topic_uuid, user=request.user).first()
    if not topic:
        raise HttpError(404, "Topic not found.")

    contents = (
        Content.objects.filter(
            execution__topic__user=request.user,
            execution__topic__uuid=topic_uuid,
        )
        .select_related("execution", "execution__topic")
        .order_by("-created_at", "-id")[offset : offset + limit]
    )

    title = f"NewsRadar Topic: {topic.primary_query or 'Topic'}"
    link = request.build_absolute_uri()
    description = f"Content feed for topic {topic.primary_query or topic.uuid}."
    feed = _build_rss_feed(
        title=title,
        link=link,
        description=description,
        contents=list(contents),
    )
    return HttpResponse(feed, content_type="application/rss+xml")


@api.get("/groups/{group_uuid}", response=ContentFeedResponse)
def list_content_by_group(
    request,
    group_uuid: UUID,
    limit: int = 50,
    offset: int = 0,
):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    queryset = Content.objects.filter(
        execution__topic__user=request.user,
        execution__topic__group__uuid=group_uuid,
    )

    bookmark_subquery = Bookmark.objects.filter(
        user=request.user,
        content_id=OuterRef("pk"),
    )

    contents = (
        queryset.select_related("execution", "execution__topic")
        .annotate(is_bookmarked=Exists(bookmark_subquery))
        .order_by("-created_at", "-id")[offset : offset + limit]
    )

    return ContentFeedResponse(
        items=[
            ContentFeedItem(
                id=content.id,
                url=content.url,
                title=content.title or "",
                summary=(content.snippet or "").strip(),
                source=content.normalized_domain(),
                created_at=content.created_at,
                published_at=content.date or content.last_updated or content.created_at,
                topic_uuid=content.execution.topic.uuid,
                topic_queries=content.execution.topic.queries or [],
                relevance_score=None,
                is_bookmarked=bool(getattr(content, "is_bookmarked", False)),
            )
            for content in contents
        ]
    )


@api.get("/groups/{group_uuid}/rss")
def list_content_by_group_rss(
    request,
    group_uuid: UUID,
    limit: int = 50,
    offset: int = 0,
):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    group = TopicGroup.objects.filter(uuid=group_uuid, user=request.user).first()
    if not group:
        raise HttpError(404, "Topic group not found.")

    contents = (
        Content.objects.filter(
            execution__topic__user=request.user,
            execution__topic__group__uuid=group_uuid,
        )
        .select_related("execution", "execution__topic")
        .order_by("-created_at", "-id")[offset : offset + limit]
    )

    title = f"NewsRadar Group: {group.name}"
    link = request.build_absolute_uri()
    description = f"Content feed for topic group {group.name}."
    feed = _build_rss_feed(
        title=title,
        link=link,
        description=description,
        contents=list(contents),
    )
    return HttpResponse(feed, content_type="application/rss+xml")


@api.get("/bookmarks", response=BookmarkListResponse)
def list_bookmarks(request):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")

    bookmarks = (
        Bookmark.objects.filter(user=request.user)
        .select_related(
            "content",
            "content__execution",
            "content__execution__topic",
        )
    )

    return BookmarkListResponse(
        bookmarks=[
            BookmarkItem(
                id=bookmark.id,
                content_id=bookmark.content_id,
                url=bookmark.content.url,
                title=bookmark.content.title or "",
                created_at=bookmark.created_at,
                topic_uuid=bookmark.content.execution.topic.uuid,
                topic_queries=bookmark.content.execution.topic.queries or [],
            )
            for bookmark in bookmarks
        ]
    )


@api.post("/bookmarks", response=BookmarkCreateResponse)
def create_bookmark(request, payload: BookmarkCreateRequest):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")

    content = (
        Content.objects.filter(
            id=payload.content_id,
            execution__topic__user=request.user,
        )
        .select_related("execution", "execution__topic")
        .first()
    )
    if not content:
        raise HttpError(404, "Content not found for user.")

    bookmark, created = Bookmark.objects.get_or_create(
        user=request.user,
        content=content,
    )

    return BookmarkCreateResponse(
        created=created,
        bookmark=BookmarkItem(
            id=bookmark.id,
            content_id=bookmark.content_id,
            url=content.url,
            title=content.title or "",
            created_at=bookmark.created_at,
            topic_uuid=content.execution.topic.uuid,
            topic_queries=content.execution.topic.queries or [],
        ),
    )


@api.delete("/bookmarks/{content_id}", response=BookmarkDeleteResponse)
def delete_bookmark(request, content_id: int):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")

    bookmark = Bookmark.objects.filter(
        user=request.user,
        content_id=content_id,
    ).first()
    if not bookmark:
        raise HttpError(404, "Bookmark not found.")

    bookmark.delete()
    return BookmarkDeleteResponse(deleted=True)
