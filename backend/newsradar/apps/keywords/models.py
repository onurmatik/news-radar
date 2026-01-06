from django.conf import settings
from django.db import models


class Board(models.Model):
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="boards",
    )
    name = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("owner", "name")]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.name}"


class KeywordGroup(models.Model):
    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="groups")
    name = models.CharField(max_length=100)

    class Meta:
        unique_together = [("board", "name")]
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.board_id}:{self.name}"


class Keyword(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        PAUSED = "paused", "Paused"
        ARCHIVED = "archived", "Archived"

    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="keywords")
    group = models.ForeignKey(
        KeywordGroup,
        on_delete=models.SET_NULL,
        related_name="keywords",
        null=True,
        blank=True,
    )
    text = models.CharField(max_length=255)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)

    search_interval_minutes = models.PositiveIntegerField(default=60)
    last_searched_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("board", "text")]
        ordering = ["text"]

    def __str__(self) -> str:
        return f"{self.text}"


class RssSource(models.Model):
    """
    One board can have multiple RSS feeds.
    """
    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="rss_sources")
    name = models.CharField(max_length=200)
    feed_url = models.URLField()
    enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("board", "feed_url")]
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name}"
