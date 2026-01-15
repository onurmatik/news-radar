from datetime import datetime
from typing import Any

from django.db.models import OuterRef, Subquery
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from newsradar.contents.models import Content
from newsradar.executions.models import Execution
from newsradar.executions.services import execute_web_search
from newsradar.topics.models import Topic

api = NinjaAPI(title="Executions API", urls_namespace="executions")


class WebSearchExecutionRequest(Schema):
    topic_uuid: str
    initiator: str = "user"


class WebSearchExecutionResponse(Schema):
    execution_id: int
    content_item_id: int | None
    initiator: str
    response: dict[str, Any]


class ExecutionListItem(Schema):
    id: int
    status: str
    initiator: str
    created_at: datetime
    content_item_id: int | None
    error_message: str | None


class ExecutionListResponse(Schema):
    executions: list[ExecutionListItem]


@api.get("/", response=ExecutionListResponse)
def list_executions(
    request,
    status: str | None = None,
    initiator: str | None = None,
):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    execution_filter = {}
    if status:
        if status not in Execution.Status.values:
            raise HttpError(400, "Invalid status.")
        execution_filter["status"] = status
    if initiator:
        if initiator not in Execution.Initiator.values:
            raise HttpError(400, "Invalid initiator.")
        execution_filter["initiator"] = initiator

    executions = (
        Execution.objects.filter(
            topic__user=request.user,
            **execution_filter,
        )
        .annotate(
            content_item_id=Subquery(
                Content.objects.filter(execution=OuterRef("pk")).values("id")[:1]
            )
        )
    )

    return ExecutionListResponse(
        executions=[
            ExecutionListItem(
                id=execution.id,
                status=execution.status,
                initiator=execution.initiator,
                created_at=execution.created_at,
                content_item_id=execution.content_item_id,
                error_message=execution.error_message,
            )
            for execution in executions
        ]
    )


@api.post("/web-search", response=WebSearchExecutionResponse)
def web_search_execution(request, payload: WebSearchExecutionRequest):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    if payload.initiator not in Execution.Initiator.values:
        raise HttpError(
            400,
            "Invalid initiator."
        )
    topic = Topic.objects.filter(uuid=payload.topic_uuid, user=request.user).first()
    if not topic:
        raise HttpError(404, "Topic not found for UUID.")
    try:
        result = execute_web_search(
            payload.topic_uuid,
            initiator=payload.initiator,
        )
    except ValueError as exc:
        raise HttpError(404, str(exc)) from exc

    return WebSearchExecutionResponse(
        **result,
        initiator=payload.initiator,
    )
