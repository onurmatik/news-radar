from datetime import datetime
import uuid

from django.db import IntegrityError
from django.db.models import Count, Max, OuterRef, Q, Subquery
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from newsradar.contents.models import Content
from newsradar.topics.models import Topic, TopicGroup, normalize_topic_query

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
    is_active: bool
    group_uuid: uuid.UUID | None
    group_name: str | None
    search_domain_allowlist: list[str] | None
    search_domain_blocklist: list[str] | None
    search_language_filter: list[str] | None
    country: str | None
    search_recency_filter: str | None


class TopicListResponse(Schema):
    topics: list[TopicListItem]


class TopicCreateRequest(Schema):
    queries: list[str]
    group_uuid: uuid.UUID | None = None
    search_domain_allowlist: list[str] | None = None
    search_domain_blocklist: list[str] | None = None
    search_language_filter: list[str] | None = None
    country: str | None = None
    search_recency_filter: str | None = None


class TopicCreateResponse(Schema):
    topic: TopicListItem


class TopicUpdateRequest(Schema):
    is_active: bool | None = None
    queries: list[str] | None = None
    search_domain_allowlist: list[str] | None = None
    search_domain_blocklist: list[str] | None = None
    search_language_filter: list[str] | None = None
    country: str | None = None
    search_recency_filter: str | None = None


class TopicGroupItem(Schema):
    id: int
    uuid: uuid.UUID
    name: str
    description: str
    is_public: bool
    default_search_recency_filter: str | None
    default_search_language_filter: list[str] | None
    default_country: str | None
    created_at: datetime
    updated_at: datetime


class TopicGroupListResponse(Schema):
    groups: list[TopicGroupItem]


class TopicGroupCreateRequest(Schema):
    name: str
    description: str | None = None
    is_public: bool | None = None
    default_search_recency_filter: str | None = None
    default_search_language_filter: list[str] | None = None
    default_country: str | None = None


class TopicGroupCreateResponse(Schema):
    group: TopicGroupItem


class TopicGroupUpdateRequest(Schema):
    name: str | None = None
    description: str | None = None
    is_public: bool | None = None
    default_search_recency_filter: str | None = None
    default_search_language_filter: list[str] | None = None
    default_country: str | None = None


@api.get("/", response=TopicListResponse)
def list_topics(
    request,
    search: str | None = None,
    group_uuid: uuid.UUID | None = None,
):
    topic_filter = Q()
    if search:
        normalized_search = normalize_topic_query(search)
        if normalized_search:
            topic_filter = Q(queries__contains=[normalized_search])

    if request.user.is_authenticated:
        topics_queryset = Topic.objects.filter(
            topic_filter,
            user=request.user,
        )
        if group_uuid:
            topics_queryset = topics_queryset.filter(group__uuid=group_uuid)
    else:
        if not group_uuid:
            raise HttpError(401, "Authentication required.")
        group = TopicGroup.objects.filter(
            uuid=group_uuid,
            is_public=True,
        ).first()
        if not group:
            raise HttpError(404, "Topic group not found for UUID.")
        topics_queryset = Topic.objects.filter(
            topic_filter,
            group=group,
            is_active=True,
        )

    topics = (
        topics_queryset.select_related("group")
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
                is_active=topic.is_active,
                group_uuid=topic.group.uuid if topic.group else None,
                group_name=topic.group.name if topic.group else None,
                search_domain_allowlist=topic.search_domain_allowlist,
                search_domain_blocklist=topic.search_domain_blocklist,
                search_language_filter=topic.search_language_filter,
                country=topic.country,
                search_recency_filter=topic.search_recency_filter,
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
    group = None
    if payload.group_uuid:
        group = TopicGroup.objects.filter(
            uuid=payload.group_uuid,
            user=request.user,
        ).first()
        if not group:
            raise HttpError(404, "Topic group not found for UUID.")

    def normalize_filter_list(values: list[str] | None, field_name: str) -> list[str] | None:
        if values is None:
            return None
        if not isinstance(values, list):
            raise HttpError(400, f"{field_name} must be a list of strings.")
        cleaned: list[str] = []
        for item in values:
            if not isinstance(item, str):
                raise HttpError(400, f"{field_name} must be a list of strings.")
            trimmed = item.strip()
            if trimmed:
                cleaned.append(trimmed)
        return cleaned or None

    domain_allowlist = normalize_filter_list(
        payload.search_domain_allowlist,
        "search_domain_allowlist",
    )
    domain_blocklist = normalize_filter_list(
        payload.search_domain_blocklist,
        "search_domain_blocklist",
    )
    if domain_allowlist and domain_blocklist:
        raise HttpError(400, "Provide either a domain allowlist or blocklist.")
    language_filter = normalize_filter_list(
        payload.search_language_filter,
        "search_language_filter",
    )

    country = payload.country.strip().upper() if isinstance(payload.country, str) else None
    if country and len(country) != 2:
        raise HttpError(400, "Country must be a 2-letter code.")

    recency_filter = payload.search_recency_filter
    if recency_filter is not None:
        recency_filter = recency_filter.strip()
        if recency_filter and recency_filter not in {"day", "week", "month", "year"}:
            raise HttpError(400, "Invalid recency filter value.")
        if recency_filter == "":
            recency_filter = None

    if group:
        if language_filter is None:
            language_filter = group.default_search_language_filter
        if country is None:
            country = group.default_country
        if recency_filter is None:
            recency_filter = group.default_search_recency_filter

    topic = Topic.objects.create(
        user=request.user,
        queries=normalized_queries,
        group=group,
        search_domain_allowlist=domain_allowlist,
        search_domain_blocklist=domain_blocklist,
        search_language_filter=language_filter,
        country=country or None,
        search_recency_filter=recency_filter,
    )

    return TopicCreateResponse(
        topic=TopicListItem(
            id=topic.id,
            uuid=topic.uuid,
            queries=topic.queries or [],
            last_fetched_at=topic.last_fetched_at,
            content_source_count=0,
            is_active=topic.is_active,
            group_uuid=topic.group.uuid if topic.group else None,
            group_name=topic.group.name if topic.group else None,
            search_domain_allowlist=topic.search_domain_allowlist,
            search_domain_blocklist=topic.search_domain_blocklist,
            search_language_filter=topic.search_language_filter,
            country=topic.country,
            search_recency_filter=topic.search_recency_filter,
        )
    )


@api.get("/groups", response=TopicGroupListResponse)
def list_topic_groups(request):
    if request.user.is_authenticated:
        groups = TopicGroup.objects.filter(user=request.user)
    else:
        groups = TopicGroup.objects.filter(is_public=True)
    groups = groups.order_by("name", "created_at")
    return TopicGroupListResponse(
        groups=[
            TopicGroupItem(
                id=group.id,
                uuid=group.uuid,
                name=group.name,
                description=group.description or "",
                is_public=group.is_public,
                default_search_recency_filter=group.default_search_recency_filter,
                default_search_language_filter=group.default_search_language_filter,
                default_country=group.default_country,
                created_at=group.created_at,
                updated_at=group.updated_at,
            )
            for group in groups
        ]
    )


@api.get("/groups/{group_uuid}", response=TopicGroupItem)
def get_topic_group(request, group_uuid: uuid.UUID):
    if request.user.is_authenticated:
        group = TopicGroup.objects.filter(
            uuid=group_uuid,
            user=request.user,
        ).first()
    else:
        group = TopicGroup.objects.filter(
            uuid=group_uuid,
            is_public=True,
        ).first()
    if not group:
        raise HttpError(404, "Topic group not found for UUID.")
    return TopicGroupItem(
        id=group.id,
        uuid=group.uuid,
        name=group.name,
        description=group.description or "",
        is_public=group.is_public,
        default_search_recency_filter=group.default_search_recency_filter,
        default_search_language_filter=group.default_search_language_filter,
        default_country=group.default_country,
        created_at=group.created_at,
        updated_at=group.updated_at,
    )


@api.post("/groups", response=TopicGroupCreateResponse)
def create_topic_group(request, payload: TopicGroupCreateRequest):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    name = payload.name.strip() if isinstance(payload.name, str) else ""
    if not name:
        raise HttpError(400, "Group name cannot be empty.")

    def normalize_filter_list(values: list[str] | None, field_name: str) -> list[str] | None:
        if values is None:
            return None
        if not isinstance(values, list):
            raise HttpError(400, f"{field_name} must be a list of strings.")
        cleaned: list[str] = []
        for item in values:
            if not isinstance(item, str):
                raise HttpError(400, f"{field_name} must be a list of strings.")
            trimmed = item.strip()
            if trimmed:
                cleaned.append(trimmed)
        return cleaned or None

    default_language_filter = normalize_filter_list(
        payload.default_search_language_filter,
        "default_search_language_filter",
    )
    default_country = payload.default_country.strip().upper() if isinstance(payload.default_country, str) else None
    if default_country and len(default_country) != 2:
        raise HttpError(400, "Country must be a 2-letter code.")
    default_recency = payload.default_search_recency_filter
    if default_recency is not None:
        default_recency = default_recency.strip()
        if default_recency and default_recency not in {"day", "week", "month", "year"}:
            raise HttpError(400, "Invalid recency filter value.")
        if default_recency == "":
            default_recency = None

    try:
        group = TopicGroup.objects.create(
            user=request.user,
            name=name,
            description=payload.description or "",
            is_public=bool(payload.is_public) if payload.is_public is not None else False,
            default_search_recency_filter=default_recency,
            default_search_language_filter=default_language_filter,
            default_country=default_country,
        )
    except IntegrityError as exc:
        raise HttpError(400, "Group name already exists.") from exc

    return TopicGroupCreateResponse(
        group=TopicGroupItem(
            id=group.id,
            uuid=group.uuid,
            name=group.name,
            description=group.description or "",
            is_public=group.is_public,
            default_search_recency_filter=group.default_search_recency_filter,
            default_search_language_filter=group.default_search_language_filter,
            default_country=group.default_country,
            created_at=group.created_at,
            updated_at=group.updated_at,
        )
    )


@api.patch("/groups/{group_uuid}", response=TopicGroupItem)
def update_topic_group(
    request,
    group_uuid: uuid.UUID,
    payload: TopicGroupUpdateRequest,
):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    group = TopicGroup.objects.filter(
        uuid=group_uuid,
        user=request.user,
    ).first()
    if not group:
        raise HttpError(404, "Topic group not found for UUID.")

    updates: dict[str, str] = {}
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HttpError(400, "Group name cannot be empty.")
        updates["name"] = name
    if payload.description is not None:
        updates["description"] = payload.description
    if payload.is_public is not None:
        updates["is_public"] = payload.is_public
    def normalize_filter_list(values: list[str] | None, field_name: str) -> list[str] | None:
        if values is None:
            return None
        if not isinstance(values, list):
            raise HttpError(400, f"{field_name} must be a list of strings.")
        cleaned: list[str] = []
        for item in values:
            if not isinstance(item, str):
                raise HttpError(400, f"{field_name} must be a list of strings.")
            trimmed = item.strip()
            if trimmed:
                cleaned.append(trimmed)
        return cleaned or None

    if payload.default_search_recency_filter is not None:
        recency = payload.default_search_recency_filter.strip()
        if recency and recency not in {"day", "week", "month", "year"}:
            raise HttpError(400, "Invalid recency filter value.")
        updates["default_search_recency_filter"] = recency or None
    if payload.default_search_language_filter is not None:
        updates["default_search_language_filter"] = normalize_filter_list(
            payload.default_search_language_filter,
            "default_search_language_filter",
        )
    if payload.default_country is not None:
        country = payload.default_country.strip().upper()
        if country and len(country) != 2:
            raise HttpError(400, "Country must be a 2-letter code.")
        updates["default_country"] = country or None

    if not updates:
        raise HttpError(400, "Provide at least one field to update.")

    for field, value in updates.items():
        setattr(group, field, value)

    try:
        group.save(update_fields=list(updates.keys()) + ["updated_at"])
    except IntegrityError as exc:
        raise HttpError(400, "Group name already exists.") from exc

    return TopicGroupItem(
        id=group.id,
        uuid=group.uuid,
        name=group.name,
        description=group.description or "",
        is_public=group.is_public,
        default_search_recency_filter=group.default_search_recency_filter,
        default_search_language_filter=group.default_search_language_filter,
        default_country=group.default_country,
        created_at=group.created_at,
        updated_at=group.updated_at,
    )


@api.delete("/groups/{group_uuid}")
def delete_topic_group(request, group_uuid: uuid.UUID):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    group = TopicGroup.objects.filter(
        uuid=group_uuid,
        user=request.user,
    ).first()
    if not group:
        raise HttpError(404, "Topic group not found for UUID.")
    group.delete()
    return {"deleted": True}


@api.patch("/{topic_uuid}", response=TopicListItem)
def update_topic(request, topic_uuid: uuid.UUID, payload: TopicUpdateRequest):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    topic = Topic.objects.filter(
        uuid=topic_uuid,
        user=request.user,
    ).first()

    if not topic:
        raise HttpError(404, "Topic not found for UUID.")

    updates: dict[str, object] = {}

    if payload.is_active is not None:
        updates["is_active"] = payload.is_active

    if payload.queries is not None:
        normalized_queries: list[str] = []
        seen = set()
        for item in payload.queries:
            if not isinstance(item, str):
                raise HttpError(400, "Topic queries must be strings.")
            normalized_item = normalize_topic_query(item)
            if not normalized_item or normalized_item in seen:
                continue
            seen.add(normalized_item)
            normalized_queries.append(normalized_item)
        if not normalized_queries:
            raise HttpError(400, "Topic queries cannot be empty.")
        updates["queries"] = normalized_queries

    def normalize_filter_list(values: list[str] | None, field_name: str) -> list[str] | None:
        if values is None:
            return None
        if not isinstance(values, list):
            raise HttpError(400, f"{field_name} must be a list of strings.")
        cleaned: list[str] = []
        for item in values:
            if not isinstance(item, str):
                raise HttpError(400, f"{field_name} must be a list of strings.")
            trimmed = item.strip()
            if trimmed:
                cleaned.append(trimmed)
        return cleaned or None

    allowlist_provided = payload.search_domain_allowlist is not None
    blocklist_provided = payload.search_domain_blocklist is not None
    domain_allowlist = normalize_filter_list(
        payload.search_domain_allowlist,
        "search_domain_allowlist",
    )
    domain_blocklist = normalize_filter_list(
        payload.search_domain_blocklist,
        "search_domain_blocklist",
    )
    if domain_allowlist and domain_blocklist:
        raise HttpError(400, "Provide either a domain allowlist or blocklist.")
    if allowlist_provided:
        updates["search_domain_allowlist"] = domain_allowlist
        if not blocklist_provided:
            updates["search_domain_blocklist"] = None
    if blocklist_provided:
        updates["search_domain_blocklist"] = domain_blocklist
        if not allowlist_provided:
            updates["search_domain_allowlist"] = None

    if payload.search_language_filter is not None:
        updates["search_language_filter"] = normalize_filter_list(
            payload.search_language_filter,
            "search_language_filter",
        )

    if payload.country is not None:
        country = payload.country.strip().upper()
        if country and len(country) != 2:
            raise HttpError(400, "Country must be a 2-letter code.")
        updates["country"] = country or None

    if payload.search_recency_filter is not None:
        updates["search_recency_filter"] = payload.search_recency_filter or None

    if not updates:
        raise HttpError(400, "Provide at least one field to update.")

    for field, value in updates.items():
        setattr(topic, field, value)

    if "queries" in updates:
        topic.save()
    else:
        topic.save(update_fields=list(updates.keys()))

    content_source_count = (
        Topic.objects.filter(pk=topic.pk)
        .annotate(
            content_source_count=Count(
                "executions__content_items",
                distinct=True,
            )
        )
        .values_list("content_source_count", flat=True)
        .first()
        or 0
    )

    return TopicListItem(
        id=topic.id,
        uuid=topic.uuid,
        queries=topic.queries or [],
        last_fetched_at=topic.last_fetched_at,
        content_source_count=content_source_count,
        is_active=topic.is_active,
        group_uuid=topic.group.uuid if topic.group else None,
        group_name=topic.group.name if topic.group else None,
        search_domain_allowlist=topic.search_domain_allowlist,
        search_domain_blocklist=topic.search_domain_blocklist,
        search_language_filter=topic.search_language_filter,
        country=topic.country,
        search_recency_filter=topic.search_recency_filter,
    )


@api.delete("/{topic_uuid}")
def delete_topic(request, topic_uuid: uuid.UUID):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    topic = Topic.objects.filter(
        uuid=topic_uuid,
        user=request.user,
    ).first()

    if not topic:
        raise HttpError(404, "Topic not found for UUID.")

    topic.delete()
    return {"deleted": True}


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
