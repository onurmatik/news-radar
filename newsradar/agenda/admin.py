from django.contrib import admin

from .models import ContentItem, ContentMatch


@admin.register(ContentItem)
class ContentItemAdmin(admin.ModelAdmin):
    list_display = ("id", "created_at", "updated_at")


@admin.register(ContentMatch)
class ContentMatchAdmin(admin.ModelAdmin):
    list_display = ("id", "keyword", "content_item", "match_score", "matched_at")
    list_select_related = ("keyword", "content_item")
