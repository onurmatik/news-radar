from django.contrib import admin

from newsradar.executions.models import Execution


@admin.register(Execution)
class ExecutionAdmin(admin.ModelAdmin):
    list_display = ("id", "topic", "initiator", "created_at", "status")
    list_filter = ("status", "initiator", "topic")
    search_fields = (
        "topic__text",
        "topic__queries",
    )
    list_select_related = ("topic",)
