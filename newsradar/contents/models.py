from urllib.parse import urlparse

from django.conf import settings
from django.db import models


class Content(models.Model):
    execution = models.ForeignKey(
        "executions.Execution",
        on_delete=models.CASCADE,
        related_name="content_items",
    )

    # de-normalization for the unique constraint
    topic = models.ForeignKey(
        "topics.Topic",
        on_delete=models.CASCADE,
        related_name="content_items",
    )

    url = models.URLField(max_length=2048)
    title = models.CharField(max_length=2048, blank=True)
    date = models.DateTimeField(blank=True, null=True)
    last_updated = models.DateTimeField(blank=True, null=True)
    snippet = models.TextField(blank=True, null=True)
    deleted_at = models.DateTimeField(blank=True, null=True, db_index=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["url", "date", "last_updated", "topic"],
                name="unique_content",
            )
        ]

    def __str__(self) -> str:
        return f"{self.id}: {self.url}"

    def normalized_domain(self) -> str:
        try:
            parsed = urlparse(self.url or "")
        except ValueError:
            return ""
        netloc = parsed.netloc.lower()
        if not netloc:
            return ""
        if "@" in netloc:
            netloc = netloc.split("@", 1)[1]
        host = netloc.split(":", 1)[0]
        if host.startswith("www."):
            host = host[4:]
        return host


class Bookmark(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="content_bookmarks",
    )
    content = models.ForeignKey(
        "contents.Content",
        on_delete=models.CASCADE,
        related_name="bookmarks",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "content"],
                name="unique_user_content_bookmark",
            )
        ]

    def __str__(self) -> str:
        return f"{self.user_id}: {self.content_id}"


class AIInteraction(models.Model):
    class Status(models.TextChoices):
        CREATED = "created", "Created"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="content_ai_interactions",
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.CREATED,
    )
    instruction = models.TextField()
    context_content_ids = models.JSONField(default=list)
    context_payload = models.JSONField(default=list)
    model_requested = models.CharField(max_length=120)
    model_used = models.CharField(max_length=120, blank=True)
    response_id = models.CharField(max_length=120, blank=True)
    response_text = models.TextField(blank=True)
    usage_payload = models.JSONField(blank=True, null=True)
    input_tokens = models.IntegerField(blank=True, null=True)
    output_tokens = models.IntegerField(blank=True, null=True)
    total_tokens = models.IntegerField(blank=True, null=True)
    credits_used = models.DecimalField(
        max_digits=20,
        decimal_places=6,
        blank=True,
        null=True,
    )
    error_message = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "-created_at"]),
            models.Index(fields=["status", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.id}: {self.user_id}: {self.status}"
