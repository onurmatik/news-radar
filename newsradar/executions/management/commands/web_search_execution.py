from django.core.management.base import BaseCommand, CommandError

from newsradar.executions.services import execute_web_search
from newsradar.executions.tasks import web_search_execution


class Command(BaseCommand):
    help = "Run a web search execution for a keyword."

    def add_arguments(self, parser):
        parser.add_argument("normalized_keyword")
        parser.add_argument(
            "--async",
            action="store_true",
            dest="run_async",
            help="Queue the execution using Celery instead of running synchronously.",
        )

    def handle(self, *args, **options):
        normalized_keyword = options["normalized_keyword"]
        if options["run_async"]:
            async_result = web_search_execution.delay(normalized_keyword)
            self.stdout.write(
                self.style.SUCCESS(
                    f"Queued web search execution task {async_result.id}."
                )
            )
            return

        try:
            result = execute_web_search(normalized_keyword)
        except ValueError as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(
            self.style.SUCCESS(
                "Created content item {content_item_id} and match {content_match_id}.".format(
                    **result
                )
            )
        )
