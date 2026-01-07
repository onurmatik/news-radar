from django.contrib import admin

from .models import Keyword


@admin.register(Keyword)
class KeywordAdmin(admin.ModelAdmin):
    list_display = ("text", "normalized_text", "created_at", "last_fetched_at")
    search_fields = ("text", "normalized_text")
