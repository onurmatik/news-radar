import re
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from openai import OpenAI
from pgvector.django import VectorField, HnswIndex


KEYWORD_NORMALIZE_RE = re.compile(r"\s+")


def normalize_keyword_query(text: str) -> str:
    return KEYWORD_NORMALIZE_RE.sub(" ", text).strip()


def validate_json_list_max_length(value: list[str] | None, max_length: int) -> None:
    if value is None:
        return
    if not isinstance(value, list):
        raise ValidationError("Expected a list of strings.")
    if len(value) > max_length:
        raise ValidationError(f"Ensure this list has at most {max_length} items.")


def validate_domain_filter(value: list[str] | None) -> None:
    validate_json_list_max_length(value, 20)


def validate_language_filter(value: list[str] | None) -> None:
    validate_json_list_max_length(value, 10)


def validate_provider_config(value: dict | None) -> None:
    if value is None:
        return
    if not isinstance(value, dict):
        raise ValidationError("Expected a JSON object for provider config.")


class Keyword(models.Model):
    uuid = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    text = models.CharField(max_length=255)
    query = models.TextField(null=True, blank=True)

    provider = models.CharField(
        max_length=20,
        default=settings.WEB_SEARCH_PROVIDER,
    )
    provider_config = models.JSONField(
        blank=True,
        null=True,
        validators=[validate_provider_config],
    )

    max_results = models.PositiveSmallIntegerField(
        default=10,
        validators=[MinValueValidator(1), MaxValueValidator(20)],
    )
    max_tokens = models.PositiveIntegerField(
        default=25000,
        validators=[MinValueValidator(1), MaxValueValidator(1_000_000)],
    )
    max_tokens_per_page = models.PositiveIntegerField(
        default=2048,
        validators=[MinValueValidator(1), MaxValueValidator(1_000_000)],
    )
    search_domain_allowlist = models.JSONField(
        blank=True,
        null=True,
        validators=[validate_domain_filter],
    )
    search_domain_blocklist = models.JSONField(
        blank=True,
        null=True,
        validators=[validate_domain_filter],
    )
    search_language_filter = models.JSONField(
        blank=True,
        null=True,
        validators=[validate_language_filter],
    )
    country = models.CharField(max_length=2, blank=True, null=True)
    search_recency_filter = models.CharField(
        max_length=5,
        blank=True,
        null=True,
        choices=[
            ("day", "day"),
            ("week", "week"),
            ("month", "month"),
            ("year", "year"),
        ],
    )
    search_after_date = models.DateField(blank=True, null=True)
    search_before_date = models.DateField(blank=True, null=True)
    last_updated_after_filter = models.DateField(blank=True, null=True)
    last_updated_before_filter = models.DateField(blank=True, null=True)

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
        return f"{self.query or self.text}"

    def save(self, *args, **kwargs) -> None:
        normalized_query = normalize_keyword_query(self.text)
        needs_embedding = False

        if self.pk:
            existing = Keyword.objects.filter(pk=self.pk).only("query").first()
            if existing and existing.query != normalized_query:
                needs_embedding = True
        else:
            needs_embedding = True

        if normalized_query != self.query:
            self.query = normalized_query

        if normalized_query and (self.embedding is None or needs_embedding):
            client = OpenAI()
            self.embedding = client.embeddings.create(
                model="text-embedding-3-small",
                input=normalized_query,
            ).data[0].embedding

        super().save(*args, **kwargs)
