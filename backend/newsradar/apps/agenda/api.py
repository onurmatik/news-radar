from datetime import date, datetime
from typing import List

from django.db.models import F, Value
from ninja import NinjaAPI, Schema
from openai import OpenAI
from pgvector.django import CosineDistance

from .models import ContentItem

api = NinjaAPI(title="Agenda API", urls_namespace="agenda")


class SimilarContentRequest(Schema):
    title: str
    date: date
    threshold: float = 0.8
    limit: int = 10


class SimilarContentResponse(Schema):
    id: int
    title: str
    published_at: datetime | None
    url: str
    similarity: float


@api.post("/similar-content", response=List[SimilarContentResponse])
def similar_content(request, payload: SimilarContentRequest):
    embedding_input = f"{payload.title} {payload.date:%B} {payload.date:%Y}"

    client = OpenAI()
    embedding = client.embeddings.create(
        model="text-embedding-3-small",
        input=embedding_input,
    ).data[0].embedding

    queryset = (
        ContentItem.objects.exclude(embedding__isnull=True)
        .annotate(distance=CosineDistance("embedding", embedding))
        .annotate(similarity=Value(1.0) - F("distance"))
        .filter(similarity__gte=payload.threshold)
        .order_by("-similarity")
    )

    return [
        SimilarContentResponse(
            id=item.id,
            title=item.title,
            published_at=item.published_at,
            url=item.canonical_url,
            similarity=item.similarity,
        )
        for item in queryset[: payload.limit]
    ]
