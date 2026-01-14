from django.contrib import admin

from newsradar.accounts.models import UserKeyword
from .models import Keyword
from newsradar.executions.tasks import web_search_execution


@admin.register(Keyword)
class KeywordAdmin(admin.ModelAdmin):
    list_display = ("uuid", "text", "query", "provider", "created_at", "last_fetched_at")
    list_filter = ("provider", "last_fetched_at", "created_at")
    search_fields = ("text", "query")
    actions = ("run_web_search",)

    def save_model(self, request, obj, form, change) -> None:
        super().save_model(request, obj, form, change)
        if not change and request.user.is_authenticated:
            UserKeyword.objects.get_or_create(user=request.user, keyword=obj)

    @admin.action(description="Run web search execution for selected keywords")
    def run_web_search(self, request, queryset):
        task_ids = []
        for keyword in queryset:
            async_result = web_search_execution.delay(
                str(keyword.uuid),
                origin_type="admin",
            )
            task_ids.append(async_result.id)

        self.message_user(
            request,
            f"Queued {len(task_ids)} web search task(s).",
        )
