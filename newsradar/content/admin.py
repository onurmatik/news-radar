from django.contrib import admin

from .models import ContentItem, ContentItemSource, ContentSource


@admin.register(ContentItem)
class ContentItemAdmin(admin.ModelAdmin):
    list_display = ("id", "keyword", "metadata", "created_at", "updated_at")
    search_fields = ("keyword__text", "keyword__normalized_text")
    list_select_related = ("keyword",)


@admin.register(ContentSource)
class ContentSourceAdmin(admin.ModelAdmin):
    list_display = ("id", "url", "title", "created_at", "updated_at")
    search_fields = ("url", "title")


@admin.register(ContentItemSource)
class ContentItemSourceAdmin(admin.ModelAdmin):
    list_display = ("id", "content_item", "content_source")
    search_fields = ("content_source__url",)
    list_select_related = ("content_item", "content_source")
