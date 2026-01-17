from django.conf import settings
from django.db import models


class Content(models.Model):
    execution = models.ForeignKey(
        "executions.Execution",
        on_delete=models.CASCADE,
        related_name="content_items",
    )
    url = models.URLField(max_length=2048)
    title = models.CharField(max_length=2048, blank=True)
    metadata = models.JSONField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-updated_at", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["execution", "url"],
                name="unique_execution_url",
            )
        ]

    def __str__(self) -> str:
        return f"{self.id}: {self.url}"


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
