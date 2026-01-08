from django.db import models


class ContentItem(models.Model):
    content = models.JSONField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-created_at"]


class ContentMatch(models.Model):
    """
    Links content items to keywords.
    """
    keyword = models.ForeignKey(
        "keywords.Keyword",
        on_delete=models.CASCADE,
        related_name="matches"
    )
    content_item = models.ForeignKey(
        "ContentItem",
        on_delete=models.CASCADE,
        related_name="matches"
    )

    match_score = models.FloatField(default=0.0)  # relevance
    matched_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("keyword", "content_item")]
        ordering = ["-matched_at"]
        verbose_name_plural = "content matches"

    def __str__(self) -> str:
        return f"{self.keyword} -> {self.content_item}"


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
    order_index = models.PositiveIntegerField()

    class Meta:
        unique_together = [("content_item", "content_source")]
