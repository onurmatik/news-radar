from django.db import models
from pgvector.django import VectorField


class RawRssEntry(models.Model):
    """
    Immutable raw entries from RSS for reprocessing.
    """
    rss_source = models.ForeignKey(
        "keywords.RssSource",
        on_delete=models.CASCADE,
        related_name="raw_entries"
    )
    url = models.URLField()
    title = models.CharField(max_length=500)
    published_at = models.DateTimeField(null=True, blank=True)
    summary = models.TextField(null=True, blank=True)
    raw_payload = models.JSONField(default=dict, blank=True)
    fetched_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("rss_source", "url")]
        ordering = ["-published_at", "-fetched_at"]

    def __str__(self) -> str:
        return self.title


class ContentItem(models.Model):
    """
    Canonical deduplicated item.
    """
    canonical_url = models.URLField(unique=True)
    title = models.CharField(max_length=500)
    published_at = models.DateTimeField(null=True, blank=True)
    source_domain = models.CharField(max_length=255)

    content_text = models.TextField(null=True, blank=True)
    ai_summary = models.TextField(null=True, blank=True)

    entities = models.JSONField(default=list, blank=True)
    topics = models.JSONField(default=list, blank=True)

    embedding = VectorField(dimensions=1536, null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-published_at", "-created_at"]

    def __str__(self) -> str:
        return self.title


class ContentMatch(models.Model):
    """
    Links content items to keywords with a match score.
    """
    keyword = models.ForeignKey(
        "keywords.Keyword",
        on_delete=models.CASCADE,
        related_name="matches"
    )
    content_item = models.ForeignKey(
        "agenda.ContentItem",
        on_delete=models.CASCADE,
        related_name="matches"
    )

    match_score = models.FloatField(default=0.0)  # heuristic/AI relevance
    matched_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("keyword", "content_item")]
        ordering = ["-matched_at"]

    def __str__(self) -> str:
        return f"{self.keyword.text} -> {self.content_item_id}"


class AgendaItem(models.Model):
    """
    Periodic summary (daily or hourly) for a board.
    Stores a summary + links to content items.
    """
    board = models.ForeignKey(
        "keywords.Board",
        on_delete=models.CASCADE,
        related_name="agenda_items"
    )
    time_bucket = models.DateField()

    title = models.CharField(max_length=300)
    summary = models.TextField()

    content_items = models.ManyToManyField(
        "agenda.ContentItem",
        related_name="agenda_items",
        blank=True,
    )

    trend_score = models.FloatField(default=0.0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("board", "time_bucket", "title")]
        ordering = ["-time_bucket", "-created_at"]

    def __str__(self) -> str:
        return f"{self.board_id}:{self.time_bucket}:{self.title}"


class KeywordSuggestion(models.Model):
    """
    AI-assisted suggestions based on recurring entities/terms.
    """
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"
        IGNORED = "ignored", "Ignored"

    board = models.ForeignKey(
        "keywords.Board",
        on_delete=models.CASCADE,
        related_name="keyword_suggestions"
    )
    suggested_text = models.CharField(max_length=255)
    reason = models.TextField(blank=True)
    estimated_impact = models.FloatField(default=0.0)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("board", "suggested_text")]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.suggested_text


class KeywordHealth(models.Model):
    """
    Tracks keyword performance (low-signal detection).
    """
    class Action(models.TextChoices):
        KEEP = "keep", "Keep"
        PAUSE = "pause", "Pause"
        REMOVE = "remove", "Remove"

    keyword = models.ForeignKey(
        "keywords.Keyword",
        on_delete=models.CASCADE,
        related_name="health"
    )
    time_bucket = models.DateField()
    signal_count = models.PositiveIntegerField(default=0)
    avg_match_score = models.FloatField(default=0.0)
    recommended_action = models.CharField(max_length=20, choices=Action.choices, default=Action.KEEP)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("keyword", "time_bucket")]
        ordering = ["-time_bucket"]

    def __str__(self) -> str:
        return f"{self.keyword.text}:{self.time_bucket}"
