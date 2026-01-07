import re

from django.db import models
from openai import OpenAI
from pgvector.django import VectorField, HnswIndex


KEYWORD_NORMALIZE_RE = re.compile(r"\s+")


def normalize_keyword_text(text: str) -> str:
    return KEYWORD_NORMALIZE_RE.sub(" ", text).strip()


class Keyword(models.Model):
    text = models.CharField(max_length=255)
    normalized_text = models.TextField(unique=True, null=True, blank=True)

    embedding = VectorField(dimensions=1536, blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    last_fetched_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            HnswIndex(
                name='keyword_embedding_hnsw',
                fields=['embedding'],
                m=16,
                ef_construction=64,
                opclasses=['vector_l2_ops']
            )
        ]
        ordering = ["-last_fetched_at", "-created_at"]

    def __str__(self) -> str:
        return f"{self.text}"

    def save(self, *args, **kwargs) -> None:
        normalized_text = normalize_keyword_text(self.text)
        needs_embedding = False

        if self.pk:
            existing = Keyword.objects.filter(pk=self.pk).only("normalized_text").first()
            if existing and existing.normalized_text != normalized_text:
                needs_embedding = True
        else:
            needs_embedding = True

        if normalized_text != self.normalized_text:
            self.normalized_text = normalized_text

        if normalized_text and (self.embedding is None or needs_embedding):
            client = OpenAI()
            self.embedding = client.embeddings.create(
                model="text-embedding-3-small",
                input=normalized_text,
            ).data[0].embedding

        super().save(*args, **kwargs)
