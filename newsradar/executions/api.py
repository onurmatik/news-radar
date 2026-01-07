from typing import Any

from django.utils import timezone
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError
from openai import OpenAI

from newsradar.agenda.models import ContentItem, ContentMatch
from newsradar.keywords.models import Keyword, normalize_keyword_text

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
    normalized_keyword = normalize_keyword_text(payload.normalized_keyword)
    keyword = Keyword.objects.filter(normalized_text=normalized_keyword).first()
    if not keyword:
        raise HttpError(404, "Keyword not found for normalized text.")

    prompt = (
        "Use web search to find the latest, up-to-date information for this keyword: "
        f"{normalized_keyword}"
    )

    client = OpenAI()
    response = client.responses.create(
        model="gpt-5",
        tools=[{"type": "web_search"}],
        input=prompt,
    )

    response_payload = response.model_dump()
    content_item = ContentItem.objects.create(
        content={
            "keyword": normalized_keyword,
            "query": prompt,
            "response": response_payload,
            "output_text": response.output_text,
        }
    )

    content_match = ContentMatch.objects.create(
        keyword=keyword,
        content_item=content_item,
        match_score=1.0,
    )

    keyword.last_fetched_at = timezone.now()
    keyword.save(update_fields=["last_fetched_at"])

    return WebSearchExecutionResponse(
        content_item_id=content_item.id,
        content_match_id=content_match.id,
        output_text=response.output_text,
        response=response_payload,
    )
