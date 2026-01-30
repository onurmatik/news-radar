import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.utils import timezone

from newsradar.contents.models import Content


class Command(BaseCommand):
    help = "Export a snapshot of Content for diffing across runs."

    def add_arguments(self, parser):
        parser.add_argument(
            "--out",
            default="snapshots",
            help="Output directory (default: snapshots).",
        )
        parser.add_argument(
            "--name",
            default="",
            help="Snapshot name. If omitted, uses UTC timestamp.",
        )
        parser.add_argument(
            "--topic-uuid",
            default="",
            help="Optional: export only one topic UUID.",
        )

    def handle(self, *args, **options):
        out_dir = Path(options["out"])
        out_dir.mkdir(parents=True, exist_ok=True)

        stamp = options["name"] or timezone.now().strftime("%Y%m%dT%H%M%SZ")
        path = out_dir / f"content_snapshot_{stamp}.jsonl"

        qs = Content.objects.select_related("execution", "execution__topic").all()
        topic_uuid = options["topic_uuid"].strip()
        if topic_uuid:
            qs = qs.filter(execution__topic__uuid=topic_uuid)

        qs = qs.order_by("id")

        count = 0
        with path.open("w", encoding="utf-8") as f:
            for c in qs.iterator(chunk_size=2000):
                # A stable key for comparing items across snapshots:
                # primary comparison is by (topic_uuid, url, date, last_updated)
                record = {
                    "content_id": c.id,
                    "execution_id": c.execution_id,
                    "topic_uuid": str(c.execution.topic.uuid),
                    "url": c.url,
                    "domain": c.normalized_domain(),
                    "title": c.title or "",
                    "snippet": (c.snippet or "").strip(),
                    "date": c.date.isoformat() if c.date else None,
                    "last_updated": c.last_updated.isoformat() if c.last_updated else None,
                    "created_at": c.created_at.isoformat() if c.created_at else None,
                }
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
                count += 1

        self.stdout.write(self.style.SUCCESS(f"Wrote {count} rows to {path}"))
