from datetime import datetime
import uuid

from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from newsradar.executions.services import preview_web_search
from newsradar.topics.models import Topic, TopicGroup, normalize_topic_query
from newsradar.topics.services import (
    build_queries,
    clamp_auto_interval_hours,
    normalize_domain_value,
    normalize_string_list,
    organize_topic_configuration,
    refine_topic_configuration,
    suggest_more_domains,
)

api = NinjaAPI(title="Topics API", urls_namespace="topics")


def _owner_label(user) -> str:
    if not user:
        return "Unknown"
    return user.username or getattr(user, "email", "") or "Unknown"


def _normalize_domain_list(values: list[str] | None) -> list[str] | None:
    if values is None:
        return None
    if not isinstance(values, list):
        raise HttpError(400, "search_domain_allowlist must be a list of strings.")
    cleaned: list[str] = []
    seen: set[str] = set()
    for item in values:
        if not isinstance(item, str):
            raise HttpError(400, "search_domain_allowlist must be a list of strings.")
        normalized = normalize_domain_value(item)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        cleaned.append(normalized)
    return cleaned or None


def _normalize_language_list(values: list[str] | None) -> list[str] | None:
    if values is None:
        return None
    if not isinstance(values, list):
        raise HttpError(400, "search_language_filter must be a list of strings.")
    return normalize_string_list(values, lower=True, max_length=10) or None


def _normalize_country(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = normalize_topic_query(value).upper()
    if not normalized:
        return None
    if len(normalized) != 2:
        raise HttpError(400, "Country must be a 2-letter code.")
    return normalized


def _normalize_update_frequency(value: str | None) -> str:
    normalized = normalize_topic_query(value or "").lower()
    if not normalized:
        return Topic.UPDATE_FREQUENCY_AUTO
    if normalized not in dict(Topic.UPDATE_FREQUENCY_CHOICES):
        raise HttpError(400, "Invalid update frequency value.")
    return normalized


def _resolve_group(request, group_uuid: uuid.UUID | None) -> TopicGroup | None:
    if not group_uuid:
        return None
    group = TopicGroup.objects.filter(uuid=group_uuid).first()
    if not group:
        raise HttpError(404, "Collection not found for UUID.")
    if group.user_id != request.user.id:
        raise HttpError(403, "Collection belongs to another user.")
    if not group.is_active:
        raise HttpError(400, "Collection is inactive.")
    return group


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
        monitoring_prompt=topic.monitoring_prompt,
        display_title=topic.display_title,
        queries=topic.queries or [],
        last_fetched_at=topic.last_fetched_at,
        content_source_count=resolved_content_source_count,
        is_active=topic.is_active,
        group_uuid=topic.group.uuid if topic.group else None,
        group_name=topic.group.name if topic.group else None,
        owner_username=_owner_label(topic.user),
        is_owner=request.user.is_authenticated and topic.user_id == request.user.id,
        search_domain_allowlist=topic.search_domain_allowlist,
        search_language_filter=topic.search_language_filter,
        country=topic.country,
        update_frequency=topic.update_frequency,
        auto_effective_interval_hours=topic.auto_effective_interval_hours,
        auto_interval_updated_at=topic.auto_interval_updated_at,
    )


def _group_to_item(*, group: TopicGroup, request) -> "TopicGroupItem":
    return TopicGroupItem(
        id=group.id,
        uuid=group.uuid,
        name=group.name,
        description=group.description or "",
        is_active=group.is_active,
        owner_username=_owner_label(group.user),
        is_owner=request.user.is_authenticated and group.user_id == request.user.id,
        created_at=group.created_at,
        updated_at=group.updated_at,
    )


class TopicListItem(Schema):
    id: int
    uuid: uuid.UUID
    monitoring_prompt: str
    display_title: str
    queries: list[str]
    last_fetched_at: datetime | None
    content_source_count: int
    is_active: bool
    group_uuid: uuid.UUID | None
    group_name: str | None
    owner_username: str
    is_owner: bool
    search_domain_allowlist: list[str] | None
    search_language_filter: list[str] | None
    country: str | None
    update_frequency: str
    auto_effective_interval_hours: int | None
    auto_interval_updated_at: datetime | None


class TopicListResponse(Schema):
    topics: list[TopicListItem]


class TopicOrganizeRequest(Schema):
    monitoring_prompt: str


class TopicSplitSuggestion(Schema):
    monitoring_prompt: str
    display_title: str
    query_variations: list[str]
    suggested_domains: list[str]
    country: str | None
    search_language_filter: list[str] | None
    topic_warning: str | None = None


class TopicOrganizeResponse(Schema):
    display_title: str
    query_variations: list[str]
    suggested_domains: list[str]
    country: str | None
    search_language_filter: list[str] | None
    topic_warning: str | None = None
    suggested_group_name: str | None = None
    split_suggestions: list[TopicSplitSuggestion]


class TopicPreviewRequest(Schema):
    queries: list[str]
    search_domain_allowlist: list[str] | None = None
    search_language_filter: list[str] | None = None
    country: str | None = None


class TopicPreviewResultItem(Schema):
    url: str
    title: str
    snippet: str
    domain: str
    published_at: datetime | None


class TopicPreviewResponse(Schema):
    items: list[TopicPreviewResultItem]


class TopicPreviewFeedbackItem(Schema):
    url: str
    title: str | None = None
    snippet: str | None = None
    domain: str | None = None
    reaction: str


class TopicRefineRequest(Schema):
    monitoring_prompt: str
    queries: list[str] | None = None
    search_domain_allowlist: list[str] | None = None
    search_language_filter: list[str] | None = None
    country: str | None = None
    feedback: list[TopicPreviewFeedbackItem]


class TopicSuggestDomainsRequest(Schema):
    monitoring_prompt: str
    selected_domains: list[str]


class TopicSuggestDomainsResponse(Schema):
    domains: list[str]


class TopicWriteRequest(Schema):
    monitoring_prompt: str
    display_title: str
    primary_query: str
    query_variations: list[str] | None = None
    group_uuid: uuid.UUID | None = None
    search_domain_allowlist: list[str] | None = None
    search_language_filter: list[str] | None = None
    country: str | None = None
    update_frequency: str | None = None
    auto_effective_interval_hours: int | None = None
    is_active: bool | None = None


class TopicCreateResponse(Schema):
    topic: TopicListItem


class TopicBulkCreateRequest(Schema):
    topics: list[TopicWriteRequest]


class TopicBulkCreateResponse(Schema):
    topics: list[TopicListItem]


class TopicGroupItem(Schema):
    id: int
    uuid: uuid.UUID
    name: str
    description: str
    is_active: bool
    owner_username: str
    is_owner: bool
    created_at: datetime
    updated_at: datetime


class TopicGroupListResponse(Schema):
    groups: list[TopicGroupItem]


class TopicGroupCreateRequest(Schema):
    name: str
    description: str | None = None


class TopicGroupCreateResponse(Schema):
    group: TopicGroupItem


class TopicGroupUpdateRequest(Schema):
    name: str | None = None
    description: str | None = None
    is_active: bool | None = None


def _build_topic_defaults(payload: TopicWriteRequest) -> dict[str, object]:
    monitoring_prompt = normalize_topic_query(payload.monitoring_prompt)
    display_title = normalize_topic_query(payload.display_title)
    if not monitoring_prompt:
        raise HttpError(400, "Monitoring prompt cannot be empty.")
    if not display_title:
        raise HttpError(400, "Display title cannot be empty.")

    queries = build_queries(payload.primary_query, payload.query_variations)
    update_frequency = _normalize_update_frequency(payload.update_frequency)
    auto_interval = payload.auto_effective_interval_hours
    if update_frequency == Topic.UPDATE_FREQUENCY_AUTO:
        auto_interval = clamp_auto_interval_hours(auto_interval)
    else:
        auto_interval = None

    return {
        "monitoring_prompt": monitoring_prompt,
        "display_title": display_title,
        "queries": queries,
        "search_domain_allowlist": _normalize_domain_list(payload.search_domain_allowlist),
        "search_language_filter": _normalize_language_list(payload.search_language_filter),
        "country": _normalize_country(payload.country),
        "update_frequency": update_frequency,
        "auto_effective_interval_hours": auto_interval,
        "is_active": True if payload.is_active is None else payload.is_active,
    }


def _create_topic_from_payload(request, payload: TopicWriteRequest) -> Topic:
    group = _resolve_group(request, payload.group_uuid)
    topic_data = _build_topic_defaults(payload)
    return Topic.objects.create(
        user=request.user,
        group=group,
        **topic_data,
    )


@api.get("/", response=TopicListResponse)
def list_topics(
    request,
    search: str | None = None,
    group_uuid: uuid.UUID | None = None,
    include_inactive: bool = False,
):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")

    topics_queryset = Topic.objects.filter(user=request.user, group__is_active=True)
    if not include_inactive:
        topics_queryset = topics_queryset.filter(is_active=True)
    if group_uuid:
        topics_queryset = topics_queryset.filter(group__uuid=group_uuid)
    if search:
        normalized_search = normalize_topic_query(search)
        if normalized_search:
            topics_queryset = topics_queryset.filter(
                Q(display_title__icontains=normalized_search)
                | Q(monitoring_prompt__icontains=normalized_search)
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
        topics=[_topic_to_item(topic=topic, request=request) for topic in topics]
    )


@api.post("/organize", response=TopicOrganizeResponse)
def organize_topic(request, payload: TopicOrganizeRequest):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    try:
        organized = organize_topic_configuration(payload.monitoring_prompt)
    except ValueError as exc:
        raise HttpError(400, str(exc)) from exc

    return TopicOrganizeResponse(
        display_title=organized["display_title"],
        query_variations=organized["query_variations"],
        suggested_domains=organized["suggested_domains"],
        country=organized["country"],
        search_language_filter=organized["search_language_filter"],
        topic_warning=organized["topic_warning"],
        suggested_group_name=organized.get("suggested_group_name"),
        split_suggestions=organized.get("split_suggestions", []),
    )


@api.post("/preview", response=TopicPreviewResponse)
def preview_topic(request, payload: TopicPreviewRequest):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    try:
        preview = preview_web_search(
            queries=payload.queries,
            search_domain_allowlist=_normalize_domain_list(payload.search_domain_allowlist),
            search_language_filter=_normalize_language_list(payload.search_language_filter),
            country=_normalize_country(payload.country),
        )
    except ValueError as exc:
        raise HttpError(400, str(exc)) from exc

    return TopicPreviewResponse(
        items=[TopicPreviewResultItem(**item) for item in preview["items"]]
    )


@api.post("/refine", response=TopicOrganizeResponse)
def refine_topic(request, payload: TopicRefineRequest):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    try:
        refined = refine_topic_configuration(
            payload.monitoring_prompt,
            queries=payload.queries,
            domains=_normalize_domain_list(payload.search_domain_allowlist),
            country=_normalize_country(payload.country),
            languages=_normalize_language_list(payload.search_language_filter),
            feedback_items=[
                item.model_dump() if hasattr(item, "model_dump") else item.dict()
                for item in payload.feedback
            ],
        )
    except ValueError as exc:
        raise HttpError(400, str(exc)) from exc

    return TopicOrganizeResponse(
        display_title=refined["display_title"],
        query_variations=refined["query_variations"],
        suggested_domains=refined["suggested_domains"],
        country=refined["country"],
        search_language_filter=refined["search_language_filter"],
        topic_warning=refined["topic_warning"],
        suggested_group_name=refined.get("suggested_group_name"),
        split_suggestions=refined.get("split_suggestions", []),
    )


@api.post("/suggest-domains", response=TopicSuggestDomainsResponse)
def suggest_domains(request, payload: TopicSuggestDomainsRequest):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    try:
        domains = suggest_more_domains(
            payload.monitoring_prompt,
            selected_domains=_normalize_domain_list(payload.selected_domains),
        )
    except ValueError as exc:
        raise HttpError(400, str(exc)) from exc

    return TopicSuggestDomainsResponse(domains=domains)


@api.post("/", response=TopicCreateResponse)
def create_topic(request, payload: TopicWriteRequest):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")

    topic = _create_topic_from_payload(request, payload)
    return TopicCreateResponse(topic=_topic_to_item(topic=topic, request=request, content_source_count=0))


@api.post("/bulk", response=TopicBulkCreateResponse)
def create_topics(request, payload: TopicBulkCreateRequest):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    if not payload.topics:
        raise HttpError(400, "Provide at least one topic.")

    created_topics: list[Topic] = []
    with transaction.atomic():
        for topic_payload in payload.topics:
            created_topics.append(_create_topic_from_payload(request, topic_payload))

    return TopicBulkCreateResponse(
        topics=[
            _topic_to_item(topic=topic, request=request, content_source_count=0)
            for topic in created_topics
        ]
    )


@api.get("/groups", response=TopicGroupListResponse)
def list_topic_groups(request, include_inactive: bool = False):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    groups = TopicGroup.objects.filter(user=request.user).select_related("user")
    if not include_inactive:
        groups = groups.filter(is_active=True)
    return TopicGroupListResponse(
        groups=[_group_to_item(group=group, request=request) for group in groups]
    )


@api.get("/groups/{group_uuid}", response=TopicGroupItem)
def get_topic_group(request, group_uuid: uuid.UUID):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    group = TopicGroup.objects.filter(uuid=group_uuid, user=request.user).select_related("user").first()
    if not group:
        raise HttpError(404, "Collection not found for UUID.")
    return _group_to_item(group=group, request=request)


@api.post("/groups", response=TopicGroupCreateResponse)
def create_topic_group(request, payload: TopicGroupCreateRequest):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    name = normalize_topic_query(payload.name or "")
    if not name:
        raise HttpError(400, "Collection name cannot be empty.")
    try:
        group = TopicGroup.objects.create(
            user=request.user,
            name=name,
            description=payload.description or "",
        )
    except IntegrityError as exc:
        raise HttpError(400, "Collection name already exists.") from exc
    return TopicGroupCreateResponse(group=_group_to_item(group=group, request=request))


@api.patch("/groups/{group_uuid}", response=TopicGroupItem)
def update_topic_group(request, group_uuid: uuid.UUID, payload: TopicGroupUpdateRequest):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    group = TopicGroup.objects.filter(uuid=group_uuid).select_related("user").first()
    if not group:
        raise HttpError(404, "Collection not found for UUID.")
    if group.user_id != request.user.id:
        raise HttpError(403, "Collection belongs to another user.")

    updates: dict[str, object] = {}
    if payload.name is not None:
        name = normalize_topic_query(payload.name)
        if not name:
            raise HttpError(400, "Collection name cannot be empty.")
        updates["name"] = name
    if payload.description is not None:
        updates["description"] = payload.description
    if payload.is_active is not None:
        updates["is_active"] = payload.is_active
    if not updates:
        raise HttpError(400, "Provide at least one field to update.")

    for field, value in updates.items():
        setattr(group, field, value)
    try:
        group.save(update_fields=list(updates.keys()) + ["updated_at"])
    except IntegrityError as exc:
        raise HttpError(400, "Collection name already exists.") from exc
    return _group_to_item(group=group, request=request)


@api.delete("/groups/{group_uuid}")
def delete_topic_group(request, group_uuid: uuid.UUID):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    group = TopicGroup.objects.filter(uuid=group_uuid).first()
    if not group:
        raise HttpError(404, "Collection not found for UUID.")
    if group.user_id != request.user.id:
        raise HttpError(403, "Collection belongs to another user.")
    group.is_active = False
    group.save(update_fields=["is_active", "updated_at"])
    return {"deactivated": True}


@api.patch("/{topic_uuid}", response=TopicListItem)
def update_topic(request, topic_uuid: uuid.UUID, payload: TopicWriteRequest):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    topic = Topic.objects.filter(uuid=topic_uuid).select_related("group", "user").first()
    if not topic:
        raise HttpError(404, "Topic not found for UUID.")
    if topic.user_id != request.user.id:
        raise HttpError(403, "Topic belongs to another user.")

    group = _resolve_group(request, payload.group_uuid)
    topic_data = _build_topic_defaults(payload)
    for field, value in topic_data.items():
        setattr(topic, field, value)
    topic.group = group
    topic.save()
    return _topic_to_item(topic=topic, request=request, content_source_count=0)


@api.delete("/{topic_uuid}")
def delete_topic(request, topic_uuid: uuid.UUID):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    topic = Topic.objects.filter(uuid=topic_uuid).first()
    if not topic:
        raise HttpError(404, "Topic not found for UUID.")
    if topic.user_id != request.user.id:
        raise HttpError(403, "Topic belongs to another user.")
    topic.is_active = False
    topic.save(update_fields=["is_active"])
    return {"deactivated": True}
