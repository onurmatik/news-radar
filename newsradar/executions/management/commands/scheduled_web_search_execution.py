from django.core.management.base import BaseCommand
from django.utils import timezone

from newsradar.executions.services import topic_is_due
from newsradar.executions.tasks import web_search_execution
from newsradar.topics.models import Topic


class Command(BaseCommand):
    help = "Queue scheduled web search executions for active topics."

    def handle(self, *args, **options):
        now = timezone.now()
        topics = Topic.objects.filter(is_active=True).only(
            "uuid",
            "update_frequency",
            "auto_effective_interval_hours",
            "last_fetched_at",
        )

        queued = 0
        for topic in topics:
            if not topic_is_due(topic, now=now):
                continue
            web_search_execution.delay(str(topic.uuid), initiator="periodic")
            queued += 1

        self.stdout.write(self.style.SUCCESS(f"Queued {queued} scheduled executions."))
