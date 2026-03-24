from datetime import datetime
import uuid

from django.db import IntegrityError
from django.db.models import Count, Max, OuterRef, Q, Subquery
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from newsradar.contents.models import Content
from newsradar.topics.models import Topic, TopicGroup, normalize_topic_query
from newsradar.topics.services import normalize_domain_value

api = NinjaAPI(title="Topics API", urls_namespace="topics")


def _owner_label(user) -> str:
    if not user:
        return "Unknown"
    return user.username or getattr(user, "email", "") or "Unknown"


def _topic_to_item(
    *,
    topic: Topic,
    request,
    content_source_count: int | None = None,
) -> "TopicListItem":
    resolved_content_source_count = (
        content_source_count
        if content_source_count is not None
        else int(getattr(topic, "content_source_count", 0) or 0)
    )
    return TopicListItem(
        id=topic.id,
        uuid=topic.uuid,
        queries=topic.queries or [],
        last_fetched_at=topic.last_fetched_at,
        content_source_count=resolved_content_source_count,
        is_active=topic.is_active,
        group_uuid=topic.group.uuid if topic.group else None,
        group_name=topic.group.name if topic.group else None,
        owner_username=_owner_label(topic.user),
        is_owner=request.user.is_authenticated and topic.user_id == request.user.id,
        search_domain_allowlist=topic.search_domain_allowlist,
        search_domain_blocklist=topic.search_domain_blocklist,
        search_language_filter=topic.search_language_filter,
        country=topic.country,
        update_frequency=topic.update_frequency,
        additional_queries_mode=topic.additional_queries_mode,
    )


def _group_to_item(
    *,
    group: TopicGroup,
    request,
) -> "TopicGroupItem":
    return TopicGroupItem(
        id=group.id,
        uuid=group.uuid,
        name=group.name,
        description=group.description or "",
        is_public=group.is_public,
        is_paused=group.is_paused,
        owner_username=_owner_label(group.user),
        is_owner=request.user.is_authenticated and group.user_id == request.user.id,
        default_update_frequency=group.default_update_frequency,
        default_search_language_filter=group.default_search_language_filter,
        default_country=group.default_country,
        created_at=group.created_at,
        updated_at=group.updated_at,
    )


def _next_group_copy_name(*, user, source_name: str) -> str:
    base_name = (source_name or "").strip() or "Imported group"
    candidate = f"{base_name} (Copy)"
    suffix = 2
    while TopicGroup.objects.filter(user=user, name=candidate).exists():
        candidate = f"{base_name} (Copy {suffix})"
        suffix += 1
    return candidate


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
    owner_username: str
    is_owner: bool
    search_domain_allowlist: list[str] | None
    search_domain_blocklist: list[str] | None
    search_language_filter: list[str] | None
    country: str | None
    update_frequency: str
    additional_queries_mode: str


class TopicListResponse(Schema):
    topics: list[TopicListItem]


class TopicCreateRequest(Schema):
    queries: list[str]
    group_uuid: uuid.UUID | None = None
    search_domain_allowlist: list[str] | None = None
    search_domain_blocklist: list[str] | None = None
    search_language_filter: list[str] | None = None
    country: str | None = None
    update_frequency: str | None = None
    additional_queries_mode: str | None = None


class TopicCreateResponse(Schema):
    topic: TopicListItem


class TopicUpdateRequest(Schema):
    is_active: bool | None = None
    queries: list[str] | None = None
    group_uuid: uuid.UUID | None = None
    search_domain_allowlist: list[str] | None = None
    search_domain_blocklist: list[str] | None = None
    search_language_filter: list[str] | None = None
    country: str | None = None
    update_frequency: str | None = None
    additional_queries_mode: str | None = None


class TopicGroupItem(Schema):
    id: int
    uuid: uuid.UUID
    name: str
    description: str
    is_public: bool
    is_paused: bool
    owner_username: str
    is_owner: bool
    default_update_frequency: str | None
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
    is_paused: bool | None = None
    default_update_frequency: str | None = None
    default_search_language_filter: list[str] | None = None
    default_country: str | None = None


class TopicGroupCreateResponse(Schema):
    group: TopicGroupItem


class TopicGroupUpdateRequest(Schema):
    name: str | None = None
    description: str | None = None
    is_public: bool | None = None
    is_paused: bool | None = None
    default_update_frequency: str | None = None
    default_search_language_filter: list[str] | None = None
    default_country: str | None = None


class SharedTopicCloneResponse(Schema):
    topic: TopicListItem
    group: TopicGroupItem | None


class SharedGroupCloneResponse(Schema):
    group: TopicGroupItem
    topics: list[TopicListItem]


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
        topics_queryset.select_related("group", "user")
        .annotate(
            content_source_count=Count(
                "executions__content_items",
                filter=Q(executions__content_items__deleted_at__isnull=True),
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
                owner_username=_owner_label(topic.user),
                is_owner=request.user.is_authenticated and topic.user_id == request.user.id,
                search_domain_allowlist=topic.search_domain_allowlist,
                search_domain_blocklist=topic.search_domain_blocklist,
                search_language_filter=topic.search_language_filter,
                country=topic.country,
                update_frequency=topic.update_frequency,
                additional_queries_mode=topic.additional_queries_mode,
            )
            for topic in topics
        ]
    )


@api.get("/shared/topics/{topic_uuid}", response=TopicListItem)
def get_shared_topic(request, topic_uuid: uuid.UUID):
    topic = (
        Topic.objects.filter(uuid=topic_uuid)
        .select_related("group", "user")
        .annotate(
            content_source_count=Count(
                "executions__content_items",
                filter=Q(executions__content_items__deleted_at__isnull=True),
                distinct=True,
            )
        )
        .first()
    )
    if not topic:
        raise HttpError(404, "Topic not found for UUID.")

    return TopicListItem(
        id=topic.id,
        uuid=topic.uuid,
        queries=topic.queries or [],
        last_fetched_at=topic.last_fetched_at,
        content_source_count=topic.content_source_count,
        is_active=topic.is_active,
        group_uuid=topic.group.uuid if topic.group else None,
        group_name=topic.group.name if topic.group else None,
        owner_username=_owner_label(topic.user),
        is_owner=request.user.is_authenticated and topic.user_id == request.user.id,
        search_domain_allowlist=topic.search_domain_allowlist,
        search_domain_blocklist=topic.search_domain_blocklist,
        search_language_filter=topic.search_language_filter,
        country=topic.country,
        update_frequency=topic.update_frequency,
        additional_queries_mode=topic.additional_queries_mode,
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
    if len(normalized_queries) > 5:
        raise HttpError(400, "Provide no more than 5 topic queries.")
    group = None
    if payload.group_uuid:
        group = TopicGroup.objects.filter(uuid=payload.group_uuid).first()
        if not group:
            raise HttpError(404, "Topic group not found for UUID.")
        if group.user_id != request.user.id:
            raise HttpError(403, "Topic group belongs to another user.")

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

    def normalize_domain_list(values: list[str] | None, field_name: str) -> list[str] | None:
        if values is None:
            return None
        if not isinstance(values, list):
            raise HttpError(400, f"{field_name} must be a list of strings.")
        cleaned: list[str] = []
        seen: set[str] = set()
        for item in values:
            if not isinstance(item, str):
                raise HttpError(400, f"{field_name} must be a list of strings.")
            normalized = normalize_domain_value(item)
            if normalized and normalized not in seen:
                cleaned.append(normalized)
                seen.add(normalized)
        return cleaned or None

    domain_allowlist = normalize_domain_list(
        payload.search_domain_allowlist,
        "search_domain_allowlist",
    )
    domain_blocklist = normalize_domain_list(
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

    update_frequency = payload.update_frequency
    if update_frequency is not None:
        update_frequency = update_frequency.strip()
        if update_frequency and update_frequency not in {"day", "week", "manual"}:
            raise HttpError(400, "Invalid update frequency value.")
        if update_frequency == "":
            update_frequency = None

    additional_queries_mode = payload.additional_queries_mode
    if additional_queries_mode is not None:
        additional_queries_mode = additional_queries_mode.strip().lower()
        if additional_queries_mode not in {
            Topic.ADDITIONAL_QUERIES_MODE_AUTO,
            Topic.ADDITIONAL_QUERIES_MODE_MANUAL,
        }:
            raise HttpError(400, "Invalid additional queries mode.")
    else:
        additional_queries_mode = Topic.ADDITIONAL_QUERIES_MODE_AUTO

    if additional_queries_mode == Topic.ADDITIONAL_QUERIES_MODE_AUTO:
        normalized_queries = normalized_queries[:1]

    if group:
        if language_filter is None:
            language_filter = group.default_search_language_filter
        if country is None:
            country = group.default_country
        if update_frequency is None:
            update_frequency = group.default_update_frequency

    topic = Topic.objects.create(
        user=request.user,
        queries=normalized_queries,
        group=group,
        search_domain_allowlist=domain_allowlist,
        search_domain_blocklist=domain_blocklist,
        search_language_filter=language_filter,
        country=country or None,
        update_frequency=update_frequency or "manual",
        additional_queries_mode=additional_queries_mode,
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
            owner_username=_owner_label(topic.user),
            is_owner=True,
            search_domain_allowlist=topic.search_domain_allowlist,
            search_domain_blocklist=topic.search_domain_blocklist,
            search_language_filter=topic.search_language_filter,
            country=topic.country,
            update_frequency=topic.update_frequency,
            additional_queries_mode=topic.additional_queries_mode,
        )
    )


@api.get("/groups", response=TopicGroupListResponse)
def list_topic_groups(request):
    if request.user.is_authenticated:
        groups = TopicGroup.objects.filter(user=request.user).select_related("user")
    else:
        groups = TopicGroup.objects.filter(is_public=True).select_related("user")
    groups = groups.order_by("name", "created_at")
    return TopicGroupListResponse(
        groups=[_group_to_item(group=group, request=request) for group in groups]
    )


@api.get("/shared/groups/{group_uuid}", response=TopicGroupItem)
def get_shared_topic_group(request, group_uuid: uuid.UUID):
    group = TopicGroup.objects.filter(uuid=group_uuid).select_related("user").first()
    if not group:
        raise HttpError(404, "Topic group not found for UUID.")

    return _group_to_item(group=group, request=request)


@api.get("/shared/groups/{group_uuid}/topics", response=TopicListResponse)
def list_shared_topics_by_group(
    request,
    group_uuid: uuid.UUID,
):
    group = TopicGroup.objects.filter(uuid=group_uuid).first()
    if not group:
        raise HttpError(404, "Topic group not found for UUID.")

    topics = (
        Topic.objects.filter(group=group)
        .select_related("group", "user")
        .annotate(
            content_source_count=Count(
                "executions__content_items",
                filter=Q(executions__content_items__deleted_at__isnull=True),
                distinct=True,
            )
        )
        .order_by("-last_fetched_at", "-created_at", "uuid")
    )

    return TopicListResponse(
        topics=[
            _topic_to_item(topic=topic, request=request)
            for topic in topics
        ]
    )


@api.post("/shared/topics/{topic_uuid}/clone", response=SharedTopicCloneResponse)
def clone_shared_topic(request, topic_uuid: uuid.UUID):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")

    source_topic = (
        Topic.objects.filter(uuid=topic_uuid)
        .select_related("group", "group__user", "user")
        .first()
    )
    if not source_topic:
        raise HttpError(404, "Topic not found for UUID.")

    target_group: TopicGroup | None = None
    if source_topic.group:
        target_group = TopicGroup.objects.filter(
            user=request.user,
            name=source_topic.group.name,
        ).first()
        if not target_group:
            target_group = TopicGroup.objects.create(
                user=request.user,
                name=source_topic.group.name,
                description=source_topic.group.description or "",
                is_public=False,
                is_paused=source_topic.group.is_paused,
                default_update_frequency=source_topic.group.default_update_frequency,
                default_search_language_filter=source_topic.group.default_search_language_filter,
                default_country=source_topic.group.default_country,
            )

    cloned_topic = Topic.objects.create(
        user=request.user,
        group=target_group,
        is_active=source_topic.is_active,
        update_frequency=source_topic.update_frequency,
        queries=list(source_topic.queries or []),
        additional_queries_mode=source_topic.additional_queries_mode,
        search_domain_allowlist=(
            list(source_topic.search_domain_allowlist)
            if source_topic.search_domain_allowlist
            else None
        ),
        search_domain_blocklist=(
            list(source_topic.search_domain_blocklist)
            if source_topic.search_domain_blocklist
            else None
        ),
        search_language_filter=(
            list(source_topic.search_language_filter)
            if source_topic.search_language_filter
            else None
        ),
        country=source_topic.country,
        search_after_date=source_topic.search_after_date,
        search_before_date=source_topic.search_before_date,
        last_updated_after_filter=source_topic.last_updated_after_filter,
        last_updated_before_filter=source_topic.last_updated_before_filter,
        embedding=(
            list(source_topic.embedding)
            if source_topic.embedding is not None
            else None
        ),
    )

    return SharedTopicCloneResponse(
        topic=_topic_to_item(
            topic=cloned_topic,
            request=request,
            content_source_count=0,
        ),
        group=_group_to_item(group=target_group, request=request) if target_group else None,
    )


@api.post("/shared/groups/{group_uuid}/clone", response=SharedGroupCloneResponse)
def clone_shared_topic_group(request, group_uuid: uuid.UUID):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")

    source_group = TopicGroup.objects.filter(uuid=group_uuid).select_related("user").first()
    if not source_group:
        raise HttpError(404, "Topic group not found for UUID.")

    cloned_group = TopicGroup.objects.create(
        user=request.user,
        name=_next_group_copy_name(
            user=request.user,
            source_name=source_group.name,
        ),
        description=source_group.description or "",
        is_public=False,
        is_paused=source_group.is_paused,
        default_update_frequency=source_group.default_update_frequency,
        default_search_language_filter=source_group.default_search_language_filter,
        default_country=source_group.default_country,
    )

    source_topics = (
        Topic.objects.filter(group=source_group)
        .select_related("group")
        .order_by("created_at", "id")
    )
    cloned_topics: list[Topic] = []
    for source_topic in source_topics:
        cloned_topics.append(
            Topic.objects.create(
                user=request.user,
                group=cloned_group,
                is_active=source_topic.is_active,
                update_frequency=source_topic.update_frequency,
                queries=list(source_topic.queries or []),
                additional_queries_mode=source_topic.additional_queries_mode,
                search_domain_allowlist=(
                    list(source_topic.search_domain_allowlist)
                    if source_topic.search_domain_allowlist
                    else None
                ),
                search_domain_blocklist=(
                    list(source_topic.search_domain_blocklist)
                    if source_topic.search_domain_blocklist
                    else None
                ),
                search_language_filter=(
                    list(source_topic.search_language_filter)
                    if source_topic.search_language_filter
                    else None
                ),
                country=source_topic.country,
                search_after_date=source_topic.search_after_date,
                search_before_date=source_topic.search_before_date,
                last_updated_after_filter=source_topic.last_updated_after_filter,
                last_updated_before_filter=source_topic.last_updated_before_filter,
                embedding=(
                    list(source_topic.embedding)
                    if source_topic.embedding is not None
                    else None
                ),
            )
        )

    return SharedGroupCloneResponse(
        group=_group_to_item(group=cloned_group, request=request),
        topics=[
            _topic_to_item(
                topic=topic,
                request=request,
                content_source_count=0,
            )
            for topic in cloned_topics
        ],
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
    return _group_to_item(group=group, request=request)


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
    default_update_frequency = payload.default_update_frequency
    if default_update_frequency is not None:
        default_update_frequency = default_update_frequency.strip()
        if default_update_frequency and default_update_frequency not in {"day", "week", "manual"}:
            raise HttpError(400, "Invalid update frequency value.")
        if default_update_frequency == "":
            default_update_frequency = None
    try:
        group = TopicGroup.objects.create(
            user=request.user,
            name=name,
            description=payload.description or "",
            is_public=bool(payload.is_public) if payload.is_public is not None else False,
            is_paused=bool(payload.is_paused) if payload.is_paused is not None else False,
            default_update_frequency=default_update_frequency,
            default_search_language_filter=default_language_filter,
            default_country=default_country,
        )
    except IntegrityError as exc:
        raise HttpError(400, "Group name already exists.") from exc

    return TopicGroupCreateResponse(group=_group_to_item(group=group, request=request))


@api.patch("/groups/{group_uuid}", response=TopicGroupItem)
def update_topic_group(
    request,
    group_uuid: uuid.UUID,
    payload: TopicGroupUpdateRequest,
):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    group = TopicGroup.objects.filter(uuid=group_uuid).first()
    if not group:
        raise HttpError(404, "Topic group not found for UUID.")
    if group.user_id != request.user.id:
        raise HttpError(403, "Topic group belongs to another user.")

    updates: dict[str, object] = {}
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HttpError(400, "Group name cannot be empty.")
        updates["name"] = name
    if payload.description is not None:
        updates["description"] = payload.description
    if payload.is_public is not None:
        updates["is_public"] = payload.is_public
    if payload.is_paused is not None:
        updates["is_paused"] = payload.is_paused
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

    if payload.default_update_frequency is not None:
        default_update_frequency = payload.default_update_frequency.strip()
        if default_update_frequency and default_update_frequency not in {"day", "week", "manual"}:
            raise HttpError(400, "Invalid update frequency value.")
        updates["default_update_frequency"] = default_update_frequency or None
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

    return _group_to_item(group=group, request=request)


@api.delete("/groups/{group_uuid}")
def delete_topic_group(request, group_uuid: uuid.UUID):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    group = TopicGroup.objects.filter(uuid=group_uuid).first()
    if not group:
        raise HttpError(404, "Topic group not found for UUID.")
    if group.user_id != request.user.id:
        raise HttpError(403, "Topic group belongs to another user.")
    group.delete()
    return {"deleted": True}


@api.patch("/{topic_uuid}", response=TopicListItem)
def update_topic(request, topic_uuid: uuid.UUID, payload: TopicUpdateRequest):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    topic = Topic.objects.filter(uuid=topic_uuid).first()
    if not topic:
        raise HttpError(404, "Topic not found for UUID.")
    if topic.user_id != request.user.id:
        raise HttpError(403, "Topic belongs to another user.")

    updates: dict[str, object] = {}
    fields_set = getattr(payload, "__fields_set__", getattr(payload, "model_fields_set", set()))

    if payload.is_active is not None:
        updates["is_active"] = payload.is_active

    if "group_uuid" in fields_set:
        if payload.group_uuid:
            group = TopicGroup.objects.filter(uuid=payload.group_uuid).first()
            if not group:
                raise HttpError(404, "Topic group not found for UUID.")
            if group.user_id != request.user.id:
                raise HttpError(403, "Topic group belongs to another user.")
        else:
            group = None
        updates["group"] = group

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
        if len(normalized_queries) > 5:
            raise HttpError(400, "Provide no more than 5 topic queries.")
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

    def normalize_domain_list(values: list[str] | None, field_name: str) -> list[str] | None:
        if values is None:
            return None
        if not isinstance(values, list):
            raise HttpError(400, f"{field_name} must be a list of strings.")
        cleaned: list[str] = []
        seen: set[str] = set()
        for item in values:
            if not isinstance(item, str):
                raise HttpError(400, f"{field_name} must be a list of strings.")
            normalized = normalize_domain_value(item)
            if normalized and normalized not in seen:
                cleaned.append(normalized)
                seen.add(normalized)
        return cleaned or None

    allowlist_provided = payload.search_domain_allowlist is not None
    blocklist_provided = payload.search_domain_blocklist is not None
    domain_allowlist = normalize_domain_list(
        payload.search_domain_allowlist,
        "search_domain_allowlist",
    )
    domain_blocklist = normalize_domain_list(
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

    if payload.update_frequency is not None:
        update_frequency = payload.update_frequency.strip()
        if update_frequency and update_frequency not in {"day", "week", "manual"}:
            raise HttpError(400, "Invalid update frequency value.")
        updates["update_frequency"] = update_frequency or "manual"

    if payload.additional_queries_mode is not None:
        additional_queries_mode = payload.additional_queries_mode.strip().lower()
        if additional_queries_mode not in {
            Topic.ADDITIONAL_QUERIES_MODE_AUTO,
            Topic.ADDITIONAL_QUERIES_MODE_MANUAL,
        }:
            raise HttpError(400, "Invalid additional queries mode.")
        updates["additional_queries_mode"] = additional_queries_mode

    if not updates:
        raise HttpError(400, "Provide at least one field to update.")

    for field, value in updates.items():
        setattr(topic, field, value)

    if (
        topic.additional_queries_mode == Topic.ADDITIONAL_QUERIES_MODE_AUTO
        and topic.queries
    ):
        trimmed_queries = topic.queries[:1]
        if trimmed_queries != topic.queries:
            topic.queries = trimmed_queries
            updates["queries"] = trimmed_queries

    if "queries" in updates:
        topic.save()
    else:
        topic.save(update_fields=list(updates.keys()))

    content_source_count = (
        Topic.objects.filter(pk=topic.pk)
        .annotate(
            content_source_count=Count(
                "executions__content_items",
                filter=Q(executions__content_items__deleted_at__isnull=True),
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
        owner_username=_owner_label(topic.user),
        is_owner=True,
        search_domain_allowlist=topic.search_domain_allowlist,
        search_domain_blocklist=topic.search_domain_blocklist,
        search_language_filter=topic.search_language_filter,
        country=topic.country,
        update_frequency=topic.update_frequency,
        additional_queries_mode=topic.additional_queries_mode,
    )


@api.delete("/{topic_uuid}")
def delete_topic(request, topic_uuid: uuid.UUID):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    topic = Topic.objects.filter(uuid=topic_uuid).first()
    if not topic:
        raise HttpError(404, "Topic not found for UUID.")
    if topic.user_id != request.user.id:
        raise HttpError(403, "Topic belongs to another user.")

    topic.delete()
    return {"deleted": True}


@api.get("/{topic_uuid}/sources", response=TopicContentSourcesResponse)
def list_topic_content_sources(request, topic_uuid: uuid.UUID):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    topic = Topic.objects.filter(uuid=topic_uuid).select_related("group").first()
    if not topic:
        raise HttpError(404, "Topic not found for UUID.")
    if topic.user_id != request.user.id:
        raise HttpError(404, "Topic not found for UUID.")

    content_items = Content.objects.filter(
        execution__topic=topic,
        deleted_at__isnull=True,
    )
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
