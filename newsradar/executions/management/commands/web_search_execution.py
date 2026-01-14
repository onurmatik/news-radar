from django.core.management.base import BaseCommand, CommandError

from newsradar.executions.services import execute_web_search
from newsradar.executions.tasks import web_search_execution


class Command(BaseCommand):
    help = "Run a web search execution for a keyword."

    def add_arguments(self, parser):
        parser.add_argument("keyword_uuid")
        parser.add_argument(
            "--async",
            action="store_true",
            dest="run_async",
            help="Queue the execution using Celery instead of running synchronously.",
        )

    def handle(self, *args, **options):
        keyword_uuid = options["keyword_uuid"]
        if options["run_async"]:
            async_result = web_search_execution.delay(
                keyword_uuid,
                origin_type="cli",
            )
            self.stdout.write(
                self.style.SUCCESS(
                    f"Queued web search execution task {async_result.id}."
                )
            )
            return

        try:
            result = execute_web_search(keyword_uuid, origin_type="cli")
        except ValueError as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(
            self.style.SUCCESS(
                "Created content item {content_item_id}.".format(**result)
            )
        )
