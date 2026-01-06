from django.db.models import F, Value
from openai import OpenAI
from pgvector.django import CosineDistance
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ContentItem
from .serializers import SimilarContentRequestSerializer


class SimilarContentView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
        serializer = SimilarContentRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        title = serializer.validated_data["title"]
        entry_date = serializer.validated_data["date"]
        threshold = serializer.validated_data["threshold"]
        limit = serializer.validated_data["limit"]

        embedding_input = f"{title} {entry_date:%B} {entry_date:%Y}"

        client = OpenAI()
        embedding = client.embeddings.create(
            model="text-embedding-3-small",
            input=embedding_input,
        ).data[0].embedding

        queryset = (
            ContentItem.objects.exclude(embedding__isnull=True)
            .annotate(distance=CosineDistance("embedding", embedding))
            .annotate(similarity=Value(1.0) - F("distance"))
            .filter(similarity__gte=threshold)
            .order_by("-similarity")
        )

        results = [
            {
                "id": item.id,
                "title": item.title,
                "published_at": item.published_at,
                "url": item.canonical_url,
                "similarity": item.similarity,
            }
            for item in queryset[:limit]
        ]

        return Response(results, status=status.HTTP_200_OK)
