from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from newsradar.executions.tasks import web_search_execution
from newsradar.topics.models import Topic


class Command(BaseCommand):
    help = "Queue scheduled web search executions for active topics."

    def handle(self, *args, **options):
        now = timezone.now()
        day_cutoff = now - timedelta(days=1)
        week_cutoff = now - timedelta(weeks=1)

        day_due = Q(update_frequency="day") & (
            Q(last_fetched_at__isnull=True) | Q(last_fetched_at__lte=day_cutoff)
        )
        week_due = Q(update_frequency="week") & (
            Q(last_fetched_at__isnull=True) | Q(last_fetched_at__lte=week_cutoff)
        )

        topics = (
            Topic.objects.filter(is_active=True)
            .filter(day_due | week_due)
            .only("uuid", "update_frequency", "last_fetched_at")
        )

        queued = 0
        for topic in topics:
            web_search_execution.delay(str(topic.uuid), initiator="periodic")
            queued += 1

        self.stdout.write(self.style.SUCCESS(f"Queued {queued} scheduled executions."))
