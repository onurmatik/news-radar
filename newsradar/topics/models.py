import re
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from openai import OpenAI
from pgvector.django import HnswIndex, VectorField


TOPIC_NORMALIZE_RE = re.compile(r"\s+")


def normalize_topic_query(text: str) -> str:
    return TOPIC_NORMALIZE_RE.sub(" ", text).strip()


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


def validate_topic_queries(value: list[str] | None) -> None:
    if value is None:
        raise ValidationError("Provide at least one topic query.")
    if not isinstance(value, list):
        raise ValidationError("Expected a list of strings.")
    if not value:
        raise ValidationError("Provide at least one topic query.")
    for item in value:
        if not isinstance(item, str):
            raise ValidationError("Expected a list of strings.")
        if not normalize_topic_query(item):
            raise ValidationError("Query entries cannot be empty.")


class Topic(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="topics",
    )
    uuid = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    group = models.ForeignKey(
        "topics.TopicGroup",
        on_delete=models.SET_NULL,
        related_name="topics",
        null=True,
        blank=True,
    )
    is_active = models.BooleanField(default=True)
    queries = models.JSONField(
        default=list,
        validators=[validate_topic_queries],
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
        default="day",
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
                name="topic_embedding_hnsw",
                fields=["embedding"],
                m=16,
                ef_construction=64,
                opclasses=["vector_l2_ops"],
            )
        ]
        ordering = ["-last_fetched_at", "-created_at"]

    def __str__(self) -> str:
        primary_query = self.primary_query
        return primary_query or ""

    @property
    def primary_query(self) -> str:
        if self.queries:
            return str(self.queries[0])
        return ""

    def save(self, *args, **kwargs) -> None:
        normalized_queries: list[str] = []
        seen = set()
        for item in (self.queries or []):
            if not isinstance(item, str):
                raise ValidationError("Queries must be a list of strings.")
            normalized_item = normalize_topic_query(item)
            if not normalized_item or normalized_item in seen:
                continue
            seen.add(normalized_item)
            normalized_queries.append(normalized_item)

        if not normalized_queries:
            raise ValidationError("Provide at least one topic query.")

        aggregate_query = ", ".join(normalized_queries)
        needs_embedding = False

        if self.pk:
            existing = Topic.objects.filter(pk=self.pk).only("queries").first()
            if existing:
                existing_queries = existing.queries or []
                if existing_queries != normalized_queries:
                    needs_embedding = True
            else:
                needs_embedding = True
        else:
            needs_embedding = True

        if self.queries != normalized_queries:
            self.queries = normalized_queries

        if aggregate_query and (self.embedding is None or needs_embedding):
            client = OpenAI()
            self.embedding = client.embeddings.create(
                model="text-embedding-3-small",
                input=aggregate_query,
            ).data[0].embedding

        super().save(*args, **kwargs)


class TopicGroup(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="topic_groups",
    )
    uuid = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    is_public = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "name"],
                name="unique_topic_group_name",
            )
        ]

    def __str__(self) -> str:
        return self.name
