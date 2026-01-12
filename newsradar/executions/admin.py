from django.contrib import admin

from newsradar.executions.models import Execution


@admin.register(Execution)
class ExecutionAdmin(admin.ModelAdmin):
    list_display = ("id", "content_item", "origin_type", "llm_config", "created_at")
    list_select_related = ("content_item",)
