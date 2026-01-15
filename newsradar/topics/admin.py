from django.contrib import admin

from .models import Topic
from newsradar.executions.tasks import web_search_execution


@admin.register(Topic)
class TopicAdmin(admin.ModelAdmin):
    list_display = ("uuid", "user", "primary_query", "created_at", "last_fetched_at")
    list_filter = ("user", "last_fetched_at", "created_at")
    search_fields = ("queries", "user__username", "user__email")
    actions = ("run_web_search",)

    def save_model(self, request, obj, form, change) -> None:
        if not obj.user_id and request.user.is_authenticated:
            obj.user = request.user
        super().save_model(request, obj, form, change)

    @admin.action(description="Run web search execution for selected topics")
    def run_web_search(self, request, queryset):
        task_ids = []
        for topic in queryset:
            async_result = web_search_execution.delay(
                str(topic.uuid),
                initiator="admin",
            )
            task_ids.append(async_result.id)

        self.message_user(
            request,
            f"Queued {len(task_ids)} web search task(s).",
        )
