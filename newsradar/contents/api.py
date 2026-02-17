import json
import logging
import math
import re
from decimal import Decimal, InvalidOperation
from datetime import datetime, timezone as dt_timezone
from email.utils import format_datetime
from typing import Any
from uuid import UUID
from xml.sax.saxutils import escape
from django.conf import settings
from django.db.models import Count, DateTimeField, Exists, OuterRef, Q
from django.db.models.functions import Coalesce
from django.http import HttpResponse
from django.utils import timezone
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError,
    BadRequestError,
    OpenAI,
    RateLimitError,
)

from newsradar.accounts.models import Profile
from newsradar.contents.models import AIInteraction, Bookmark, Content
from newsradar.topics.models import Topic, TopicGroup

api = NinjaAPI(title="Contents API", urls_namespace="contents")
logger = logging.getLogger(__name__)

_MODEL_MAX_INPUT_TOKENS: dict[str, int] = {
    "gpt-5": 400_000,
    "gpt-5-mini": 400_000,
    "gpt-5-nano": 400_000,
    "gpt-4.1": 1_047_576,
    "gpt-4.1-mini": 1_047_576,
    "gpt-4.1-nano": 1_047_576,
}
_TOKEN_ESTIMATE_CHARS_PER_TOKEN = 3
_TOKEN_ESTIMATE_SAFETY_MARGIN = 512
_MODEL_DATE_SUFFIX_PATTERN = re.compile(r"-\d{4}-\d{2}-\d{2}$")


def _resolve_max_input_tokens(model_name: str) -> int | None:
    configured = getattr(settings, "OPENAI_RESPONSES_MAX_INPUT_TOKENS", None)
    if isinstance(configured, int) and configured > 0:
        return configured

    normalized = (model_name or "").strip().lower()
    if not normalized:
        return None
    if normalized in _MODEL_MAX_INPUT_TOKENS:
        return _MODEL_MAX_INPUT_TOKENS[normalized]

    without_date_suffix = _MODEL_DATE_SUFFIX_PATTERN.sub("", normalized)
    if without_date_suffix in _MODEL_MAX_INPUT_TOKENS:
        return _MODEL_MAX_INPUT_TOKENS[without_date_suffix]

    for known_model, token_limit in _MODEL_MAX_INPUT_TOKENS.items():
        if normalized.startswith(f"{known_model}-"):
            return token_limit
    return None


def _estimate_text_tokens(text: str) -> int:
    if not text:
        return 0
    return max(1, math.ceil(len(text) / _TOKEN_ESTIMATE_CHARS_PER_TOKEN))


def _build_ai_input(
    instruction: str,
    news_context: list[dict[str, Any]],
) -> str:
    return json.dumps(
        {
            "instruction": instruction,
            "news_context": news_context,
        },
        ensure_ascii=False,
    )


def _trim_news_context_to_input_budget(
    instruction: str,
    news_context: list[dict[str, Any]],
    max_input_tokens: int | None,
) -> list[dict[str, Any]]:
    if max_input_tokens is None:
        return news_context

    trimmed_context = list(news_context)
    while trimmed_context:
        candidate_input = _build_ai_input(instruction, trimmed_context)
        estimated_tokens = _estimate_text_tokens(candidate_input) + _TOKEN_ESTIMATE_SAFETY_MARGIN
        if estimated_tokens <= max_input_tokens:
            return trimmed_context
        trimmed_context.pop()
    return []


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
        published_at = content.last_updated or content.date or content.created_at
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


def _get_visit_baseline(user) -> datetime | None:
    if not user or not user.is_authenticated:
        return None
    profile = Profile.objects.filter(user=user).only(
        "last_visit_at",
        "previous_visit_at",
    ).first()
    if not profile:
        return None
    return profile.previous_visit_at or profile.last_visit_at


def _apply_new_filter(queryset, baseline: datetime | None, only_new: bool):
    if not only_new:
        return queryset
    if not baseline:
        return queryset.none()
    return queryset.filter(last_updated__gt=baseline)


def _apply_search_filter(queryset, search: str | None):
    search_value = (search or "").strip()
    if not search_value:
        return queryset
    return queryset.filter(
        Q(title__icontains=search_value)
        | Q(snippet__icontains=search_value)
        | Q(url__icontains=search_value)
    )


def _content_published_at_expression():
    return Coalesce(
        "last_updated",
        "date",
        "created_at",
        output_field=DateTimeField(),
    )


def _active_contents_queryset():
    return Content.objects.filter(deleted_at__isnull=True)


def _latest_content_per_topic_url(queryset):
    queryset = queryset.filter(deleted_at__isnull=True).annotate(
        content_published_at=_content_published_at_expression()
    )
    newer_content_subquery = (
        _active_contents_queryset().filter(
            topic_id=OuterRef("topic_id"),
            url=OuterRef("url"),
        )
        .annotate(content_published_at=_content_published_at_expression())
        .filter(
            Q(content_published_at__gt=OuterRef("content_published_at"))
            | Q(
                content_published_at=OuterRef("content_published_at"),
                id__gt=OuterRef("id"),
            )
        )
    )
    return queryset.filter(~Exists(newer_content_subquery))


def _latest_deleted_content_per_topic_url(queryset):
    queryset = queryset.filter(deleted_at__isnull=False)
    newer_deleted_content_subquery = Content.objects.filter(
        topic_id=OuterRef("topic_id"),
        url=OuterRef("url"),
        deleted_at__isnull=False,
    ).filter(
        Q(deleted_at__gt=OuterRef("deleted_at"))
        | Q(
            deleted_at=OuterRef("deleted_at"),
            id__gt=OuterRef("id"),
        )
    )
    return queryset.filter(~Exists(newer_deleted_content_subquery))


def _serialize_content_for_ai(content: Content) -> dict[str, Any]:
    published_at = content.last_updated or content.date or content.created_at
    return {
        "id": content.id,
        "url": content.url,
        "title": content.title or "",
        "source": content.normalized_domain(),
        "summary": (content.snippet or "").strip(),
        "published_at": (
            published_at.isoformat() if isinstance(published_at, datetime) else None
        ),
        "topic_uuid": str(content.execution.topic.uuid),
        "topic_queries": content.execution.topic.queries or [],
    }


def _extract_ai_response_text(response: Any) -> str:
    output_text = getattr(response, "output_text", None)
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    output = getattr(response, "output", None) or []
    message_chunks: list[str] = []
    for item in output:
        if isinstance(item, dict):
            if item.get("type") != "message":
                continue
            content_chunks = item.get("content") or []
            for chunk in content_chunks:
                text_value = chunk.get("text") if isinstance(chunk, dict) else None
                if isinstance(text_value, str) and text_value.strip():
                    message_chunks.append(text_value.strip())
            continue

        if getattr(item, "type", None) != "message":
            continue
        for chunk in getattr(item, "content", None) or []:
            text_value = None
            if isinstance(chunk, dict):
                text_value = chunk.get("text")
            else:
                text_value = getattr(chunk, "text", None)
            if isinstance(text_value, str) and text_value.strip():
                message_chunks.append(text_value.strip())

    return "\n".join(message_chunks).strip()


def _extract_response_usage_tokens(response: Any) -> tuple[int | None, int | None, int | None]:
    usage = getattr(response, "usage", None)
    if usage is None:
        return None, None, None
    if isinstance(usage, dict):
        input_tokens = usage.get("input_tokens")
        output_tokens = usage.get("output_tokens")
        total_tokens = usage.get("total_tokens")
        return input_tokens, output_tokens, total_tokens

    return (
        getattr(usage, "input_tokens", None),
        getattr(usage, "output_tokens", None),
        getattr(usage, "total_tokens", None),
    )


def _extract_response_usage_payload(response: Any) -> dict[str, Any] | None:
    usage = getattr(response, "usage", None)
    if usage is None:
        return None
    if isinstance(usage, dict):
        return usage
    model_dump = getattr(usage, "model_dump", None)
    if callable(model_dump):
        payload = model_dump()
        if isinstance(payload, dict):
            return payload
    return None


def _extract_response_credits(
    usage_payload: dict[str, Any] | None,
    total_tokens: int | None,
) -> Decimal | None:
    if usage_payload:
        for key in (
            "credits",
            "credit",
            "consumed_credits",
            "total_credits",
            "cost",
            "total_cost",
        ):
            value = usage_payload.get(key)
            if value is None:
                continue
            try:
                return Decimal(str(value))
            except (InvalidOperation, TypeError, ValueError):
                continue
    if total_tokens is not None:
        return Decimal(total_tokens)
    return None


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


class ContentDeleteResponse(Schema):
    deleted: bool
    soft_deleted_count: int


class ContentRestoreResponse(Schema):
    restored: bool
    restored_count: int


class TrashContentItem(Schema):
    id: int
    url: str
    title: str
    summary: str
    source: str
    created_at: datetime
    published_at: datetime | None
    deleted_at: datetime
    topic_uuid: UUID
    topic_queries: list[str]


class TrashContentResponse(Schema):
    items: list[TrashContentItem]


class TrashEmptyResponse(Schema):
    deleted: bool
    permanently_deleted_count: int


class AIInteractionRequest(Schema):
    content_ids: list[int]
    instruction: str
    model: str | None = None


class AIInteractionResponse(Schema):
    answer: str
    model: str
    response_id: str | None
    content_count: int
    input_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None


class NotificationTopicItem(Schema):
    topic_uuid: UUID
    topic_queries: list[str]
    group_uuid: UUID | None
    group_name: str | None
    new_count: int


class NotificationsResponse(Schema):
    total_new: int
    topics: list[NotificationTopicItem]


@api.get("/items/{content_id}", response=ContentFeedItem)
def get_content_item(request, content_id: int):
    if request.user.is_authenticated:
        bookmark_subquery = Bookmark.objects.filter(
            user=request.user,
            content__topic_id=OuterRef("topic_id"),
            content__url=OuterRef("url"),
            content__deleted_at__isnull=True,
        )
        content = (
            _active_contents_queryset().filter(
                id=content_id,
                execution__topic__user=request.user,
            )
            .select_related("execution", "execution__topic")
            .annotate(is_bookmarked=Exists(bookmark_subquery))
            .first()
        )
    else:
        content = (
            _active_contents_queryset().filter(
                id=content_id,
                execution__topic__group__is_public=True,
                execution__topic__is_active=True,
            )
            .select_related("execution", "execution__topic")
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
        published_at=content.last_updated or content.date or content.created_at,
        topic_uuid=content.execution.topic.uuid,
        topic_queries=content.execution.topic.queries or [],
        relevance_score=None,
        is_bookmarked=bool(getattr(content, "is_bookmarked", False)),
    )


@api.get("/items/{content_id}/detail", response=ContentDetailItem)
def get_content_detail(request, content_id: int):
    if request.user.is_authenticated:
        bookmark_subquery = Bookmark.objects.filter(
            user=request.user,
            content__topic_id=OuterRef("topic_id"),
            content__url=OuterRef("url"),
            content__deleted_at__isnull=True,
        )
        content = (
            _active_contents_queryset().filter(
                id=content_id,
                execution__topic__user=request.user,
            )
            .select_related("execution", "execution__topic")
            .annotate(is_bookmarked=Exists(bookmark_subquery))
            .first()
        )
    else:
        content = (
            _active_contents_queryset().filter(
                id=content_id,
                execution__topic__group__is_public=True,
                execution__topic__is_active=True,
            )
            .select_related("execution", "execution__topic")
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
        published_at=content.last_updated or content.date or content.created_at,
        topic_uuid=content.execution.topic.uuid,
        topic_queries=content.execution.topic.queries or [],
        relevance_score=None,
        is_bookmarked=bool(getattr(content, "is_bookmarked", False)),
    )


@api.delete("/items/{content_id}", response=ContentDeleteResponse)
def delete_content_item(request, content_id: int):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")

    content = (
        Content.objects.filter(
            id=content_id,
            execution__topic__user=request.user,
        )
        .only("id", "topic_id", "url")
        .first()
    )
    if not content:
        raise HttpError(404, "Content not found for user.")

    soft_deleted_count = Content.objects.filter(
        execution__topic__user=request.user,
        topic_id=content.topic_id,
        url=content.url,
        deleted_at__isnull=True,
    ).update(deleted_at=timezone.now())
    Bookmark.objects.filter(
        user=request.user,
        content__topic_id=content.topic_id,
        content__url=content.url,
    ).delete()

    return ContentDeleteResponse(
        deleted=True,
        soft_deleted_count=soft_deleted_count,
    )


@api.post("/items/{content_id}/restore", response=ContentRestoreResponse)
def restore_content_item(request, content_id: int):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")

    content = (
        Content.objects.filter(
            id=content_id,
            execution__topic__user=request.user,
            deleted_at__isnull=False,
        )
        .only("id", "topic_id", "url")
        .first()
    )
    if not content:
        raise HttpError(404, "Deleted content not found for user.")

    restored_count = Content.objects.filter(
        execution__topic__user=request.user,
        topic_id=content.topic_id,
        url=content.url,
        deleted_at__isnull=False,
    ).update(deleted_at=None)

    return ContentRestoreResponse(
        restored=True,
        restored_count=restored_count,
    )


@api.get("/trash", response=TrashContentResponse)
def list_trashed_content(
    request,
    limit: int = 50,
    offset: int = 0,
):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")

    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    queryset = _latest_deleted_content_per_topic_url(
        Content.objects.filter(execution__topic__user=request.user)
    )
    contents = (
        queryset.select_related("execution", "execution__topic")
        .order_by("-deleted_at", "-id")[offset : offset + limit]
    )

    return TrashContentResponse(
        items=[
            TrashContentItem(
                id=content.id,
                url=content.url,
                title=content.title or "",
                summary=(content.snippet or "").strip(),
                source=content.normalized_domain(),
                created_at=content.created_at,
                published_at=content.last_updated or content.date or content.created_at,
                deleted_at=content.deleted_at,
                topic_uuid=content.execution.topic.uuid,
                topic_queries=content.execution.topic.queries or [],
            )
            for content in contents
            if content.deleted_at is not None
        ]
    )


@api.delete("/trash", response=TrashEmptyResponse)
def empty_trashed_content(request):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")

    permanently_deleted_count, _ = Content.objects.filter(
        execution__topic__user=request.user,
        deleted_at__isnull=False,
    ).delete()
    return TrashEmptyResponse(
        deleted=True,
        permanently_deleted_count=permanently_deleted_count,
    )


@api.post("/ai/respond", response=AIInteractionResponse)
def ai_respond(request, payload: AIInteractionRequest):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    if not settings.OPENAI_API_KEY:
        logger.error("OPENAI_API_KEY is not configured.")
        raise HttpError(500, "AI provider is not configured.")

    instruction = (payload.instruction or "").strip()
    if not instruction:
        raise HttpError(400, "Instruction cannot be empty.")
    if len(instruction) > settings.OPENAI_RESPONSES_MAX_INSTRUCTION_CHARS:
        raise HttpError(
            400,
            (
                "Instruction is too long. Maximum length is "
                f"{settings.OPENAI_RESPONSES_MAX_INSTRUCTION_CHARS} characters."
            ),
        )

    normalized_content_ids: list[int] = []
    seen_content_ids: set[int] = set()
    for content_id in payload.content_ids or []:
        if not isinstance(content_id, int) or content_id <= 0:
            raise HttpError(400, "content_ids must contain positive integers.")
        if content_id not in seen_content_ids:
            normalized_content_ids.append(content_id)
            seen_content_ids.add(content_id)

    if not normalized_content_ids:
        raise HttpError(400, "Provide at least one content ID.")

    model_name = (payload.model or "").strip() or settings.OPENAI_RESPONSES_MODEL.strip()
    if not model_name:
        logger.error("OPENAI_RESPONSES_MODEL is empty.")
        raise HttpError(500, "AI model is not configured.")
    max_input_tokens = _resolve_max_input_tokens(model_name)

    selected_contents = list(
        _active_contents_queryset().filter(
            id__in=normalized_content_ids,
            execution__topic__user=request.user,
        ).select_related("execution", "execution__topic")
    )
    contents_by_id = {content.id: content for content in selected_contents}
    missing_content_ids = [
        content_id
        for content_id in normalized_content_ids
        if content_id not in contents_by_id
    ]
    if missing_content_ids:
        raise HttpError(404, "One or more content items were not found for user.")

    ordered_contents = [
        contents_by_id[content_id]
        for content_id in normalized_content_ids
    ]
    news_context = [
        _serialize_content_for_ai(content)
        for content in ordered_contents
    ]
    trimmed_news_context = _trim_news_context_to_input_budget(
        instruction=instruction,
        news_context=news_context,
        max_input_tokens=max_input_tokens,
    )
    if not trimmed_news_context:
        if max_input_tokens is not None:
            raise HttpError(
                400,
                (
                    "Instruction and content exceed the model input token limit "
                    f"({max_input_tokens})."
                ),
            )
        raise HttpError(400, "Unable to build AI context from selected items.")

    if len(trimmed_news_context) < len(news_context):
        logger.info(
            "Trimmed AI context from %s to %s items due to input token budget.",
            len(news_context),
            len(trimmed_news_context),
        )

    ai_input = _build_ai_input(instruction, trimmed_news_context)
    trimmed_context_ids = [item["id"] for item in trimmed_news_context]

    interaction = AIInteraction.objects.create(
        user=request.user,
        status=AIInteraction.Status.CREATED,
        instruction=instruction,
        context_content_ids=trimmed_context_ids,
        context_payload=trimmed_news_context,
        model_requested=model_name,
    )

    def _mark_interaction_failed(error_message: str) -> None:
        if interaction.status == AIInteraction.Status.COMPLETED:
            return
        interaction.status = AIInteraction.Status.FAILED
        interaction.error_message = error_message
        interaction.save(
            update_fields=[
                "status",
                "error_message",
            ]
        )

    try:
        client = OpenAI(
            api_key=settings.OPENAI_API_KEY,
            timeout=settings.OPENAI_RESPONSES_TIMEOUT_SECONDS,
        )
        response_request_kwargs: dict[str, Any] = dict(
            model=model_name,
            instructions=(
                "You are a precise news assistant. Use only the provided news_context. "
                "If the context is insufficient, explicitly state the uncertainty."
            ),
            input=ai_input,
        )
        if settings.OPENAI_RESPONSES_MAX_OUTPUT_TOKENS is not None:
            response_request_kwargs["max_output_tokens"] = settings.OPENAI_RESPONSES_MAX_OUTPUT_TOKENS
        response = client.responses.create(**response_request_kwargs)
        answer = _extract_ai_response_text(response)
        input_tokens, output_tokens, total_tokens = _extract_response_usage_tokens(response)
        usage_payload = _extract_response_usage_payload(response)
        credits_used = _extract_response_credits(usage_payload, total_tokens)
        response_model = str(getattr(response, "model", model_name) or model_name)
        response_id = str(getattr(response, "id", "") or "")

        interaction.model_used = response_model
        interaction.response_id = response_id
        interaction.response_text = answer
        interaction.usage_payload = usage_payload
        interaction.input_tokens = input_tokens
        interaction.output_tokens = output_tokens
        interaction.total_tokens = total_tokens
        interaction.credits_used = credits_used

        if not answer:
            logger.error(
                "Responses API returned empty output. response_id=%s",
                response_id or None,
            )
            interaction.status = AIInteraction.Status.FAILED
            interaction.error_message = "AI provider returned an empty response."
            interaction.save(
                update_fields=[
                    "model_used",
                    "response_id",
                    "response_text",
                    "usage_payload",
                    "input_tokens",
                    "output_tokens",
                    "total_tokens",
                    "credits_used",
                    "status",
                    "error_message",
                ]
            )
            raise HttpError(502, "AI provider returned an empty response.")

        interaction.status = AIInteraction.Status.COMPLETED
        interaction.error_message = None
        interaction.save(
            update_fields=[
                "model_used",
                "response_id",
                "response_text",
                "usage_payload",
                "input_tokens",
                "output_tokens",
                "total_tokens",
                "credits_used",
                "status",
                "error_message",
            ]
        )
        return AIInteractionResponse(
            answer=answer,
            model=response_model,
            response_id=response_id or None,
            content_count=len(trimmed_news_context),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
        )
    except HttpError as exc:
        _mark_interaction_failed(str(exc))
        raise
    except BadRequestError:
        _mark_interaction_failed("Invalid AI interaction request.")
        logger.exception("AI provider rejected request.")
        raise HttpError(400, "Invalid AI interaction request.")
    except AuthenticationError:
        _mark_interaction_failed("AI provider authentication failed.")
        logger.exception("AI provider authentication failed.")
        raise HttpError(502, "AI provider authentication failed.")
    except RateLimitError:
        _mark_interaction_failed("AI provider rate limit reached.")
        logger.warning("AI provider rate limit reached.", exc_info=True)
        raise HttpError(429, "AI provider rate limit reached. Please retry.")
    except (APIConnectionError, APITimeoutError):
        _mark_interaction_failed("AI provider is temporarily unavailable.")
        logger.warning("AI provider unavailable.", exc_info=True)
        raise HttpError(503, "AI provider is temporarily unavailable. Please retry.")
    except APIStatusError as exc:
        status_code = getattr(exc, "status_code", None)
        _mark_interaction_failed(f"AI provider request failed with status {status_code}.")
        logger.warning(
            "AI provider returned status error. status_code=%s",
            status_code,
            exc_info=True,
        )
        if status_code == 429:
            raise HttpError(429, "AI provider rate limit reached. Please retry.")
        if isinstance(status_code, int) and status_code >= 500:
            raise HttpError(503, "AI provider is temporarily unavailable. Please retry.")
        raise HttpError(502, "AI provider request failed.")
    except Exception:
        _mark_interaction_failed("Unexpected error during AI interaction.")
        logger.exception("Unexpected error during AI interaction endpoint.")
        raise HttpError(500, "Unexpected error during AI interaction.")


@api.get("/", response=ContentFeedResponse)
def list_content(
    request,
    topic_uuid: UUID | None = None,
    limit: int = 50,
    offset: int = 0,
    only_new: bool = False,
    search: str | None = None,
):
    if not request.user.is_authenticated and not topic_uuid:
        raise HttpError(401, "Authentication required.")
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    if request.user.is_authenticated:
        baseline = _get_visit_baseline(request.user) if only_new else None
        if topic_uuid:
            topic = Topic.objects.filter(uuid=topic_uuid).select_related("group").first()
            if not topic:
                raise HttpError(404, "Topic not found.")
            if topic.user_id != request.user.id:
                raise HttpError(404, "Topic not found.")
            queryset = _active_contents_queryset().filter(execution__topic=topic)
        else:
            queryset = _active_contents_queryset().filter(execution__topic__user=request.user)

        queryset = _latest_content_per_topic_url(queryset)
        queryset = _apply_new_filter(queryset, baseline, only_new)
        queryset = _apply_search_filter(queryset, search)
        bookmark_subquery = Bookmark.objects.filter(
            user=request.user,
            content__topic_id=OuterRef("topic_id"),
            content__url=OuterRef("url"),
            content__deleted_at__isnull=True,
        )
        contents = (
            queryset.select_related("execution", "execution__topic")
            .annotate(is_bookmarked=Exists(bookmark_subquery))
            .order_by("-content_published_at", "-id")[offset : offset + limit]
        )
    else:
        topic = Topic.objects.filter(
            uuid=topic_uuid,
            group__is_public=True,
            is_active=True,
        ).first()
        if not topic:
            raise HttpError(404, "Topic not found.")
        queryset = _latest_content_per_topic_url(
            _active_contents_queryset().filter(
                execution__topic=topic,
            )
        )
        queryset = _apply_search_filter(queryset, search)
        contents = (
            queryset
            .select_related("execution", "execution__topic")
            .order_by("-content_published_at", "-id")[offset : offset + limit]
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
                published_at=content.last_updated or content.date or content.created_at,
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
    only_new: bool = False,
    search: str | None = None,
):
    return list_content(
        request,
        topic_uuid=topic_uuid,
        limit=limit,
        offset=offset,
        only_new=only_new,
        search=search,
    )


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
            group__is_public=True,
            is_active=True,
        ).first()
    if not topic:
        raise HttpError(404, "Topic not found.")

    contents = (
        _active_contents_queryset().filter(
            execution__topic=topic,
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


@api.get("/groups/{group_uuid}", response=ContentFeedResponse)
def list_content_by_group(
    request,
    group_uuid: UUID,
    limit: int = 50,
    offset: int = 0,
    only_new: bool = False,
    search: str | None = None,
):
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    if request.user.is_authenticated:
        group = TopicGroup.objects.filter(uuid=group_uuid).first()
        if not group:
            raise HttpError(404, "Topic group not found.")
        if group.user_id != request.user.id:
            raise HttpError(404, "Topic group not found.")
        queryset = Content.objects.filter(
            deleted_at__isnull=True,
            execution__topic__user=request.user,
            execution__topic__group__uuid=group_uuid,
        )
        queryset = _latest_content_per_topic_url(queryset)
        if only_new:
            baseline = _get_visit_baseline(request.user)
            queryset = _apply_new_filter(queryset, baseline, only_new)
        queryset = _apply_search_filter(queryset, search)

        bookmark_subquery = Bookmark.objects.filter(
            user=request.user,
            content__topic_id=OuterRef("topic_id"),
            content__url=OuterRef("url"),
            content__deleted_at__isnull=True,
        )

        contents = (
            queryset.select_related("execution", "execution__topic")
            .annotate(is_bookmarked=Exists(bookmark_subquery))
            .order_by("-content_published_at", "-id")[offset : offset + limit]
        )
    else:
        group = TopicGroup.objects.filter(
            uuid=group_uuid,
            is_public=True,
        ).first()
        if not group:
            raise HttpError(404, "Topic group not found.")
        queryset = _latest_content_per_topic_url(
            _active_contents_queryset().filter(
                execution__topic__group=group,
                execution__topic__is_active=True,
            )
        )
        queryset = _apply_search_filter(queryset, search)
        contents = (
            queryset
            .select_related("execution", "execution__topic")
            .order_by("-content_published_at", "-id")[offset : offset + limit]
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
                published_at=content.last_updated or content.date or content.created_at,
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
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    if request.user.is_authenticated:
        group = TopicGroup.objects.filter(uuid=group_uuid).first()
        if group and group.user_id != request.user.id:
            group = None
    else:
        group = TopicGroup.objects.filter(
            uuid=group_uuid,
            is_public=True,
        ).first()
    if not group:
        raise HttpError(404, "Topic group not found.")

    contents_filter = {"execution__topic__group": group}
    if not request.user.is_authenticated:
        contents_filter["execution__topic__is_active"] = True
    contents = (
        _active_contents_queryset().filter(**contents_filter)
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
        Bookmark.objects.filter(
            user=request.user,
            content__deleted_at__isnull=True,
        )
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
        _active_contents_queryset().filter(
            id=payload.content_id,
            execution__topic__user=request.user,
        )
        .select_related("execution", "execution__topic")
        .first()
    )
    if not content:
        raise HttpError(404, "Content not found for user.")

    bookmark = (
        Bookmark.objects.filter(
            user=request.user,
            content__topic_id=content.topic_id,
            content__url=content.url,
        )
        .select_related(
            "content",
            "content__execution",
            "content__execution__topic",
        )
        .order_by("-created_at", "-id")
        .first()
    )
    created = False
    if not bookmark:
        bookmark = Bookmark.objects.create(
            user=request.user,
            content=content,
        )
        bookmark = (
            Bookmark.objects.filter(id=bookmark.id)
            .select_related(
                "content",
                "content__execution",
                "content__execution__topic",
            )
            .first()
        )
        created = True

    return BookmarkCreateResponse(
        created=created,
        bookmark=BookmarkItem(
            id=bookmark.id,
            content_id=bookmark.content_id,
            url=bookmark.content.url,
            title=bookmark.content.title or "",
            created_at=bookmark.created_at,
            topic_uuid=bookmark.content.execution.topic.uuid,
            topic_queries=bookmark.content.execution.topic.queries or [],
        ),
    )


@api.delete("/bookmarks/{content_id}", response=BookmarkDeleteResponse)
def delete_bookmark(request, content_id: int):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")

    content = (
        _active_contents_queryset().filter(
            id=content_id,
            execution__topic__user=request.user,
        )
        .only("id", "topic_id", "url")
        .first()
    )
    if not content:
        raise HttpError(404, "Content not found for user.")

    deleted_count, _ = Bookmark.objects.filter(
        user=request.user,
        content__topic_id=content.topic_id,
        content__url=content.url,
    ).delete()
    if deleted_count == 0:
        raise HttpError(404, "Bookmark not found.")

    return BookmarkDeleteResponse(deleted=True)


@api.get("/notifications", response=NotificationsResponse)
def list_notifications(request):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    baseline = _get_visit_baseline(request.user)
    if not baseline:
        return NotificationsResponse(total_new=0, topics=[])

    counts = (
        _active_contents_queryset().filter(
            execution__topic__user=request.user,
            last_updated__gt=baseline,
        )
        .values(
            "execution__topic__uuid",
            "execution__topic__queries",
            "execution__topic__group__uuid",
            "execution__topic__group__name",
        )
        .annotate(new_count=Count("id"))
        .order_by("-new_count")
    )

    topics = [
        NotificationTopicItem(
            topic_uuid=row["execution__topic__uuid"],
            topic_queries=row["execution__topic__queries"] or [],
            group_uuid=row["execution__topic__group__uuid"],
            group_name=row["execution__topic__group__name"],
            new_count=row["new_count"],
        )
        for row in counts
    ]
    total_new = sum(item.new_count for item in topics)
    return NotificationsResponse(total_new=total_new, topics=topics)
