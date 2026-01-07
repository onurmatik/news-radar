from django.contrib import admin

from .models import Board, Keyword, KeywordGroup, RssSource


@admin.register(Board)
class BoardAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "owner", "created_at")
    list_select_related = ("owner",)
    search_fields = ("name", "owner__email", "owner__username")


@admin.register(KeywordGroup)
class KeywordGroupAdmin(admin.ModelAdmin):
    list_display = ("id", "board", "name")
    list_select_related = ("board",)
    search_fields = ("name",)


@admin.register(Keyword)
class KeywordAdmin(admin.ModelAdmin):
    list_display = ("id", "board", "text", "status", "search_interval_minutes")
    list_select_related = ("board", "group")
    list_filter = ("status",)
    search_fields = ("text",)


@admin.register(RssSource)
class RssSourceAdmin(admin.ModelAdmin):
    list_display = ("id", "board", "name", "feed_url", "enabled")
    list_select_related = ("board",)
    search_fields = ("name", "feed_url")
