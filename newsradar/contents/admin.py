from django.contrib import admin

from .models import Content


@admin.register(Content)
class ContentAdmin(admin.ModelAdmin):
    list_display = ("id", "execution", "url", "title", "created_at", "updated_at")
    search_fields = ("execution__topic__text", "execution__topic__queries", "url", "title")
    list_select_related = ("execution", "execution__topic")
