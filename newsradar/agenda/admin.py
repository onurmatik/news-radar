from django.contrib import admin

from .models import ContentItem, ContentItemSource, ContentMatch, ContentSource


@admin.register(ContentItem)
class ContentItemAdmin(admin.ModelAdmin):
    list_display = ("id", "created_at", "updated_at")


@admin.register(ContentMatch)
class ContentMatchAdmin(admin.ModelAdmin):
    list_display = ("id", "keyword", "content_item", "match_score", "matched_at")
    list_select_related = ("keyword", "content_item")


@admin.register(ContentSource)
class ContentSourceAdmin(admin.ModelAdmin):
    list_display = ("id", "url", "title")
    search_fields = ("url", "title")


@admin.register(ContentItemSource)
class ContentItemSourceAdmin(admin.ModelAdmin):
    list_display = ("id", "content_item", "content_source", "order_index")
    list_select_related = ("content_item", "content_source")
