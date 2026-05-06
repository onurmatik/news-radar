from uuid import UUID

from django.http import HttpResponse
from django.db.models import DateTimeField
from django.db.models.functions import Coalesce
from ninja import NinjaAPI
from ninja.errors import HttpError

from newsradar.contents.api import _build_rss_feed
from newsradar.contents.models import Content
from newsradar.topics.models import Topic, TopicGroup

api = NinjaAPI(title="Contents RSS", urls_namespace="contents_rss")


@api.get("/topics/{topic_uuid}/rss")
def list_content_by_topic_rss(
    request,
    topic_uuid: UUID,
    limit: int = 50,
    offset: int = 0,
):
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    if request.user.is_authenticated:
        topic = Topic.objects.filter(uuid=topic_uuid).select_related("group").first()
        if topic and topic.user_id != request.user.id:
            topic = None
    else:
        topic = Topic.objects.filter(
            uuid=topic_uuid,
            is_active=True,
            group__is_active=True,
        ).first()
    if topic and (not topic.is_active or not topic.group.is_active):
        topic = None
    if not topic:
        raise HttpError(404, "Topic not found.")

    if request.user.is_authenticated and topic.user_id == request.user.id:
        contents = (
            Content.objects.filter(
                execution__topic__user=request.user,
                execution__topic__uuid=topic_uuid,
                execution__topic__is_active=True,
                execution__topic__group__is_active=True,
            )
            .select_related("execution", "execution__topic")
            .order_by(
                Coalesce(
                    "last_updated",
                    "date",
                    "created_at",
                    output_field=DateTimeField(),
                ).desc(),
                "-id",
            )[offset : offset + limit]
        )
    else:
        contents = (
            Content.objects.filter(
                execution__topic=topic,
                execution__topic__is_active=True,
                execution__topic__group__is_active=True,
            )
            .select_related("execution", "execution__topic")
            .order_by(
                Coalesce(
                    "last_updated",
                    "date",
                    "created_at",
                    output_field=DateTimeField(),
                ).desc(),
                "-id",
            )[offset : offset + limit]
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


@api.get("/groups/{group_uuid}/rss")
def list_content_by_group_rss(
    request,
    group_uuid: UUID,
    limit: int = 50,
    offset: int = 0,
):
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    if request.user.is_authenticated:
        group = TopicGroup.objects.filter(uuid=group_uuid, is_active=True).first()
        if group and group.user_id != request.user.id:
            group = None
    else:
        group = TopicGroup.objects.filter(uuid=group_uuid, is_active=True).first()
    if not group:
        raise HttpError(404, "Collection not found.")

    if request.user.is_authenticated and group.user_id == request.user.id:
        contents = (
            Content.objects.filter(
                execution__topic__user=request.user,
                execution__topic__group__uuid=group_uuid,
                execution__topic__is_active=True,
                execution__topic__group__is_active=True,
            )
            .select_related("execution", "execution__topic")
            .order_by(
                Coalesce(
                    "last_updated",
                    "date",
                    "created_at",
                    output_field=DateTimeField(),
                ).desc(),
                "-id",
            )[offset : offset + limit]
        )
    else:
        contents = (
            Content.objects.filter(
                execution__topic__group=group,
                execution__topic__is_active=True,
                execution__topic__group__is_active=True,
            )
            .select_related("execution", "execution__topic")
            .order_by(
                Coalesce(
                    "last_updated",
                    "date",
                    "created_at",
                    output_field=DateTimeField(),
                ).desc(),
                "-id",
            )[offset : offset + limit]
        )

    title = f"NewsRadar Collection: {group.name}"
    link = request.build_absolute_uri()
    description = f"Content feed for collection {group.name}."
    feed = _build_rss_feed(
        title=title,
        link=link,
        description=description,
        contents=list(contents),
    )
    return HttpResponse(feed, content_type="application/rss+xml")
