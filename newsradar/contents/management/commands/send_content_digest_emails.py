from django.core.management.base import BaseCommand

from newsradar.contents.digests import send_unviewed_content_email_digests


class Command(BaseCommand):
    help = (
        "Send digest emails for unviewed content and mark successfully "
        "delivered items as viewed."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--user-id",
            action="append",
            dest="user_ids",
            type=int,
            help="Limit digest sending to one or more user IDs.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would be sent without delivering email or updating content.",
        )

    def handle(self, *args, **options):
        summary = send_unviewed_content_email_digests(
            user_ids=options["user_ids"] or None,
            dry_run=options["dry_run"],
        )
        self.stdout.write(
            (
                "processed_users={processed_users} sent_users={sent_users} "
                "skipped_users={skipped_users} items_sent={items_sent} "
                "marked_viewed={marked_viewed} dry_run={dry_run}"
            ).format(**summary)
        )
