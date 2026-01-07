from django.contrib import admin

from .models import Keyword


@admin.register(Keyword)
class KeywordAdmin(admin.ModelAdmin):
    list_display = ("id", "text", "status", "created_at", "last_fetched_at")
    list_filter = ("status",)
    search_fields = ("text",)
