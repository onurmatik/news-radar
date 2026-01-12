from django.contrib import admin

from newsradar.executions.models import Execution


@admin.register(Execution)
class ExecutionAdmin(admin.ModelAdmin):
    list_display = ("id", "content_item", "origin_type", "created_at", "status")
    list_filter = ("status",)
    list_select_related = ("content_item",)
