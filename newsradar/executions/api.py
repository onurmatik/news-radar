from datetime import datetime
from typing import Any

from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from newsradar.executions.models import Execution
from newsradar.executions.services import execute_web_search

api = NinjaAPI(title="Executions API", urls_namespace="executions")


class WebSearchExecutionRequest(Schema):
    normalized_keyword: str
    origin_type: str = "user"


class WebSearchExecutionResponse(Schema):
    execution_id: int
    content_item_id: int
    origin_type: str
    response: dict[str, Any]


class ExecutionListItem(Schema):
    id: int
    status: str
    origin_type: str
    created_at: datetime
    content_item_id: int | None
    error_message: str | None


class ExecutionListResponse(Schema):
    executions: list[ExecutionListItem]


@api.get("/", response=ExecutionListResponse)
def list_executions(
    request,
    status: str | None = None,
    origin_type: str | None = None,
):
    execution_filter = {}
    if status:
        if status not in Execution.Status.values:
            raise HttpError(400, "Invalid status.")
        execution_filter["status"] = status
    if origin_type:
        if origin_type not in Execution.OriginType.values:
            raise HttpError(400, "Invalid origin_type.")
        execution_filter["origin_type"] = origin_type

    executions = Execution.objects.filter(**execution_filter)

    return ExecutionListResponse(
        executions=[
            ExecutionListItem(
                id=execution.id,
                status=execution.status,
                origin_type=execution.origin_type,
                created_at=execution.created_at,
                content_item_id=execution.content_item_id,
                error_message=execution.error_message,
            )
            for execution in executions
        ]
    )


@api.post("/web-search", response=WebSearchExecutionResponse)
def web_search_execution(request, payload: WebSearchExecutionRequest):
    if payload.origin_type not in Execution.OriginType.values:
        raise HttpError(
            400,
            "Invalid origin_type."
        )
    try:
        result = execute_web_search(
            payload.normalized_keyword,
            origin_type=payload.origin_type,
        )
    except ValueError as exc:
        raise HttpError(404, str(exc)) from exc

    return WebSearchExecutionResponse(
        **result,
        origin_type=payload.origin_type,
    )
