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

    def __str__(self) -> str:
        return f"{self.keyword.text} -> {self.content_item_id}"
