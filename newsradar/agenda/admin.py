from django.contrib import admin

from .models import (
    AgendaItem,
    ContentItem,
    ContentMatch,
    KeywordHealth,
    KeywordSuggestion,
    RawRssEntry,
)


@admin.register(ContentItem)
class ContentItemAdmin(admin.ModelAdmin):
    list_display = ("id", "title", "source_domain", "published_at", "created_at")
    search_fields = ("title", "canonical_url", "source_domain")


@admin.register(ContentMatch)
class ContentMatchAdmin(admin.ModelAdmin):
    list_display = ("id", "keyword", "content_item", "match_score", "matched_at")
    list_select_related = ("keyword", "content_item")


@admin.register(AgendaItem)
class AgendaItemAdmin(admin.ModelAdmin):
    list_display = ("id", "board", "time_bucket", "title", "trend_score", "created_at")
    list_select_related = ("board",)
    search_fields = ("title",)


@admin.register(KeywordSuggestion)
class KeywordSuggestionAdmin(admin.ModelAdmin):
    list_display = ("id", "board", "suggested_text", "status", "created_at")
    list_select_related = ("board",)
    search_fields = ("suggested_text",)


@admin.register(KeywordHealth)
class KeywordHealthAdmin(admin.ModelAdmin):
    list_display = ("id", "keyword", "time_bucket", "signal_count", "avg_match_score")
    list_select_related = ("keyword",)


@admin.register(RawRssEntry)
class RawRssEntryAdmin(admin.ModelAdmin):
    list_display = ("id", "rss_source", "title", "published_at", "fetched_at")
    list_select_related = ("rss_source",)
    search_fields = ("title", "url")
