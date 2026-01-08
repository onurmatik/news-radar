from django.contrib import admin

from .models import Keyword
from newsradar.executions.tasks import web_search_execution


@admin.register(Keyword)
class KeywordAdmin(admin.ModelAdmin):
    list_display = ("text", "normalized_text", "created_at", "last_fetched_at")
    search_fields = ("text", "normalized_text")
    actions = ("run_web_search",)

    @admin.action(description="Run web search execution for selected keywords")
    def run_web_search(self, request, queryset):
        task_ids = []
        for keyword in queryset:
            async_result = web_search_execution.delay(
                keyword.normalized_text,
                origin_type="admin",
            )
            task_ids.append(async_result.id)

        self.message_user(
            request,
            f"Queued {len(task_ids)} web search task(s).",
        )
