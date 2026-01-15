from django.core.management.base import BaseCommand, CommandError

from newsradar.executions.services import execute_web_search
from newsradar.executions.tasks import web_search_execution


class Command(BaseCommand):
    help = "Run a web search execution for a topic."

    def add_arguments(self, parser):
        parser.add_argument("topic_uuid")
        parser.add_argument(
            "--async",
            action="store_true",
            dest="run_async",
            help="Queue the execution using Celery instead of running synchronously.",
        )

    def handle(self, *args, **options):
        topic_uuid = options["topic_uuid"]
        if options["run_async"]:
            async_result = web_search_execution.delay(
                topic_uuid,
                initiator="cli",
            )
            self.stdout.write(
                self.style.SUCCESS(
                    f"Queued web search execution task {async_result.id}."
                )
            )
            return

        try:
            result = execute_web_search(topic_uuid, initiator="cli")
        except ValueError as exc:
            raise CommandError(str(exc)) from exc

        if result.get("content_item_id") is None:
            self.stdout.write(self.style.WARNING("No content sources were returned."))
            return

        self.stdout.write(
            self.style.SUCCESS(
                "Created content item {content_item_id}.".format(**result)
            )
        )
