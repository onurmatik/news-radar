from django.db import models


class ContentItem(models.Model):
    class OriginType(models.TextChoices):
        PERIODIC = "periodic", "Periodic"
        USER = "user", "User"
        ADMIN = "admin", "Admin"
        CLI = "cli", "CLI"

    content = models.JSONField(blank=True, null=True)
    origin_type = models.CharField(
        max_length=20,
        choices=OriginType.choices,
        default=OriginType.USER,
    )
    keyword = models.ForeignKey(
        "keywords.Keyword",
        on_delete=models.SET_NULL,
        related_name="content_items",
        null=True,
        blank=True,
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-created_at"]


class ContentSource(models.Model):
    url = models.URLField(max_length=2048, unique=True)
    title = models.CharField(max_length=2048, blank=True)

    def __str__(self) -> str:
        return f"{self.url}"


class ContentItemSource(models.Model):
    content_item = models.ForeignKey(
        "ContentItem",
        on_delete=models.CASCADE,
        related_name="source_links"
    )
    content_source = models.ForeignKey(
        "ContentSource",
        on_delete=models.CASCADE,
        related_name="content_links"
    )

    class Meta:
        unique_together = [("content_item", "content_source")]
