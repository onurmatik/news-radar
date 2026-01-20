from urllib.parse import urlparse

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
    date = models.DateTimeField(blank=True, null=True)
    last_updated = models.DateTimeField(blank=True, null=True)
    snippet = models.TextField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["execution", "url", "last_updated"],
                name="unique_execution_url",
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
