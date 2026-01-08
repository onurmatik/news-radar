from typing import Any

from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from newsradar.executions.services import execute_web_search

api = NinjaAPI(title="Executions API", urls_namespace="executions")


class WebSearchExecutionRequest(Schema):
    normalized_keyword: str
    origin_type: str = "user"


class WebSearchExecutionResponse(Schema):
    content_item_id: int
    origin_type: str
    output_text: str | None
    response: dict[str, Any]


@api.post("/web-search", response=WebSearchExecutionResponse)
def web_search_execution(request, payload: WebSearchExecutionRequest):
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
