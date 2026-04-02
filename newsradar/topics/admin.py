from django.contrib import admin

from .models import Topic, TopicGroup
from newsradar.executions.tasks import web_search_execution


@admin.register(TopicGroup)
class TopicGroupAdmin(admin.ModelAdmin):
    list_display = ("uuid", "name", "user", "created_at", "updated_at")
    list_filter = ("user", "created_at")
    search_fields = ("name", "description", "user__username", "user__email")


@admin.register(Topic)
class TopicAdmin(admin.ModelAdmin):
    list_display = (
        "uuid",
        "user",
        "display_title",
        "primary_query",
        "group",
        "update_frequency",
        "is_active",
        "created_at",
        "last_fetched_at",
    )
    list_editable = ("update_frequency",)
    list_filter = ("user", "group", "is_active", "last_fetched_at", "created_at")
    search_fields = ("display_title", "monitoring_prompt", "queries", "user__username", "user__email")
    actions = (
        "run_web_search",
        "set_update_frequency_auto",
        "set_update_frequency_hourly",
        "set_update_frequency_daily",
        "set_update_frequency_weekly",
        "set_update_frequency_manual",
    )

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

    @admin.action(description="Set update frequency to auto")
    def set_update_frequency_auto(self, request, queryset):
        updated = queryset.update(update_frequency=Topic.UPDATE_FREQUENCY_AUTO)
        self.message_user(request, f"Updated {updated} topic(s) to auto.")

    @admin.action(description="Set update frequency to hourly")
    def set_update_frequency_hourly(self, request, queryset):
        updated = queryset.update(update_frequency=Topic.UPDATE_FREQUENCY_HOUR)
        self.message_user(request, f"Updated {updated} topic(s) to hourly.")

    @admin.action(description="Set update frequency to daily")
    def set_update_frequency_daily(self, request, queryset):
        updated = queryset.update(update_frequency=Topic.UPDATE_FREQUENCY_DAY)
        self.message_user(request, f"Updated {updated} topic(s) to daily.")

    @admin.action(description="Set update frequency to weekly")
    def set_update_frequency_weekly(self, request, queryset):
        updated = queryset.update(update_frequency=Topic.UPDATE_FREQUENCY_WEEK)
        self.message_user(request, f"Updated {updated} topic(s) to weekly.")

    @admin.action(description="Set update frequency to manual")
    def set_update_frequency_manual(self, request, queryset):
        updated = queryset.update(update_frequency=Topic.UPDATE_FREQUENCY_MANUAL)
        self.message_user(request, f"Updated {updated} topic(s) to manual.")
