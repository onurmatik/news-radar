from typing import Any

from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from newsradar.executions.services import execute_web_search

api = NinjaAPI(title="Executions API", urls_namespace="executions")


class WebSearchExecutionRequest(Schema):
    normalized_keyword: str


class WebSearchExecutionResponse(Schema):
    content_item_id: int
    content_match_id: int
    output_text: str | None
    response: dict[str, Any]


@api.post("/web-search", response=WebSearchExecutionResponse)
def web_search_execution(request, payload: WebSearchExecutionRequest):
    try:
        result = execute_web_search(payload.normalized_keyword)
    except ValueError as exc:
        raise HttpError(404, str(exc)) from exc

    return WebSearchExecutionResponse(**result)
