from django.contrib import admin

from newsradar.executions.models import Execution


@admin.register(Execution)
class ExecutionAdmin(admin.ModelAdmin):
    list_display = ("id", "content_item", "origin_type", "created_at", "status")
    list_filter = ("status", "origin_type")
    search_fields = (
        "content_item__keyword__text",
        "content_item__keyword__normalized_text",
    )
    list_select_related = ("content_item",)
