import re
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone
from openai import OpenAI
from pgvector.django import HnswIndex, VectorField


TOPIC_NORMALIZE_RE = re.compile(r"\s+")
AUTO_FREQUENCY_MIN_HOURS = 1
AUTO_FREQUENCY_MAX_HOURS = 168


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
    validate_json_list_max_length(value, 5)
    for item in value:
        if not isinstance(item, str):
            raise ValidationError("Expected a list of strings.")
        if not normalize_topic_query(item):
            raise ValidationError("Query entries cannot be empty.")


class Topic(models.Model):
    UPDATE_FREQUENCY_AUTO = "auto"
    UPDATE_FREQUENCY_HOUR = "hour"
    UPDATE_FREQUENCY_DAY = "day"
    UPDATE_FREQUENCY_WEEK = "week"
    UPDATE_FREQUENCY_MANUAL = "manual"
    UPDATE_FREQUENCY_CHOICES = [
        (UPDATE_FREQUENCY_AUTO, UPDATE_FREQUENCY_AUTO),
        (UPDATE_FREQUENCY_HOUR, UPDATE_FREQUENCY_HOUR),
        (UPDATE_FREQUENCY_DAY, UPDATE_FREQUENCY_DAY),
        (UPDATE_FREQUENCY_WEEK, UPDATE_FREQUENCY_WEEK),
        (UPDATE_FREQUENCY_MANUAL, UPDATE_FREQUENCY_MANUAL),
    ]

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
    monitoring_prompt = models.TextField(blank=True, default="")
    display_title = models.CharField(max_length=200, blank=True, default="")
    update_frequency = models.CharField(
        max_length=6,
        choices=UPDATE_FREQUENCY_CHOICES,
        default=UPDATE_FREQUENCY_AUTO,
    )
    auto_effective_interval_hours = models.PositiveSmallIntegerField(
        blank=True,
        null=True,
    )
    auto_interval_updated_at = models.DateTimeField(blank=True, null=True)
    queries = models.JSONField(
        default=list,
        validators=[validate_topic_queries],
    )
    search_domain_allowlist = models.JSONField(
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
        return self.display_title or self.primary_query or ""

    @property
    def primary_query(self) -> str:
        if self.queries:
            return str(self.queries[0])
        return ""

    def save(self, *args, **kwargs) -> None:
        normalized_queries: list[str] = []
        seen: set[str] = set()
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
        validate_json_list_max_length(normalized_queries, 5)

        normalized_prompt = normalize_topic_query(self.monitoring_prompt or "")
        if not normalized_prompt:
            normalized_prompt = normalized_queries[0]
        normalized_title = normalize_topic_query(self.display_title or "")
        if not normalized_title:
            normalized_title = normalized_queries[0]

        normalized_languages: list[str] = []
        seen_languages: set[str] = set()
        for item in (self.search_language_filter or []):
            if not isinstance(item, str):
                raise ValidationError("Language filters must be a list of strings.")
            normalized_item = normalize_topic_query(item).lower()
            if not normalized_item or normalized_item in seen_languages:
                continue
            seen_languages.add(normalized_item)
            normalized_languages.append(normalized_item)
        validate_language_filter(normalized_languages or None)

        normalized_country = normalize_topic_query(self.country or "").upper() or None
        if normalized_country and len(normalized_country) != 2:
            raise ValidationError("Country must be a 2-letter code.")

        if self.update_frequency not in dict(self.UPDATE_FREQUENCY_CHOICES):
            raise ValidationError("Invalid update frequency.")

        if self.update_frequency == self.UPDATE_FREQUENCY_AUTO:
            interval = self.auto_effective_interval_hours
            if interval is None:
                interval = 24
            interval = max(AUTO_FREQUENCY_MIN_HOURS, min(AUTO_FREQUENCY_MAX_HOURS, int(interval)))
            self.auto_effective_interval_hours = interval
            if self.auto_interval_updated_at is None:
                self.auto_interval_updated_at = timezone.now()
        else:
            self.auto_effective_interval_hours = None
            self.auto_interval_updated_at = None

        aggregate_query = " | ".join([normalized_title, *normalized_queries])
        needs_embedding = False

        if self.pk:
            existing = (
                Topic.objects.filter(pk=self.pk)
                .only("queries", "display_title", "monitoring_prompt")
                .first()
            )
            if existing:
                if (
                    (existing.queries or []) != normalized_queries
                    or (existing.display_title or "") != normalized_title
                    or (existing.monitoring_prompt or "") != normalized_prompt
                ):
                    needs_embedding = True
            else:
                needs_embedding = True
        else:
            needs_embedding = self.embedding is None

        self.queries = normalized_queries
        self.monitoring_prompt = normalized_prompt
        self.display_title = normalized_title
        self.search_language_filter = normalized_languages or None
        self.country = normalized_country

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
