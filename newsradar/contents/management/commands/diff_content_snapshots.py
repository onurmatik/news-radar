import json
from collections import defaultdict, Counter
from dataclasses import dataclass
from pathlib import Path

from django.core.management.base import BaseCommand


@dataclass(frozen=True)
class ItemKey:
    topic_uuid: str
    url: str
    date: str | None
    last_updated: str | None


def load_snapshot(path: Path) -> dict[ItemKey, dict]:
    items: dict[ItemKey, dict] = {}
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            row = json.loads(line)
            key = ItemKey(
                topic_uuid=row["topic_uuid"],
                url=row["url"],
                date=row.get("date"),
                last_updated=row.get("last_updated"),
            )
            items[key] = row
    return items


class Command(BaseCommand):
    help = "Diff two exported Content snapshots (jsonl) and print + write summary."

    def add_arguments(self, parser):
        parser.add_argument("before", help="Path to older snapshot jsonl.")
        parser.add_argument("after", help="Path to newer snapshot jsonl.")
        parser.add_argument(
            "--out",
            default="snapshots",
            help="Output directory for reports (default: snapshots).",
        )
        parser.add_argument(
            "--top",
            type=int,
            default=20,
            help="Top N domains to show (default: 20).",
        )

    def handle(self, *args, **options):
        before_path = Path(options["before"])
        after_path = Path(options["after"])
        out_dir = Path(options["out"])
        out_dir.mkdir(parents=True, exist_ok=True)
        top_n = int(options["top"])

        before = load_snapshot(before_path)
        after = load_snapshot(after_path)

        before_keys = set(before.keys())
        after_keys = set(after.keys())

        added_keys = after_keys - before_keys
        removed_keys = before_keys - after_keys
        common_keys = before_keys & after_keys

        # Changes among common keys (same key but title/snippet changed)
        changed = []
        for k in common_keys:
            b = before[k]
            a = after[k]
            if (b.get("title") or "") != (a.get("title") or "") or (b.get("snippet") or "") != (a.get("snippet") or ""):
                changed.append((k, b, a))

        # Per-topic stats
        per_topic = defaultdict(lambda: {"added": 0, "removed": 0, "changed": 0})
        for k in added_keys:
            per_topic[k.topic_uuid]["added"] += 1
        for k in removed_keys:
            per_topic[k.topic_uuid]["removed"] += 1
        for k, _, _ in changed:
            per_topic[k.topic_uuid]["changed"] += 1

        # Domain counters (added/removed)
        added_domains = Counter(after[k].get("domain") or "" for k in added_keys)
        removed_domains = Counter(before[k].get("domain") or "" for k in removed_keys)

        def pct(x: int, total: int) -> float:
            return (100.0 * x / total) if total else 0.0

        summary = {
            "before_file": str(before_path),
            "after_file": str(after_path),
            "counts": {
                "before": len(before),
                "after": len(after),
                "added": len(added_keys),
                "removed": len(removed_keys),
                "changed": len(changed),
            },
            "per_topic": dict(per_topic),
            "top_added_domains": added_domains.most_common(top_n),
            "top_removed_domains": removed_domains.most_common(top_n),
        }

        report_path = out_dir / f"diff_{before_path.stem}__{after_path.stem}.json"
        report_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

        # Console summary
        self.stdout.write(self.style.SUCCESS("Snapshot diff summary"))
        self.stdout.write(f"Before:  {before_path} ({len(before)} items)")
        self.stdout.write(f"After:   {after_path} ({len(after)} items)")
        self.stdout.write(f"Added:   {len(added_keys)} ({pct(len(added_keys), len(after)):.1f}% of after)")
        self.stdout.write(f"Removed: {len(removed_keys)} ({pct(len(removed_keys), len(before)):.1f}% of before)")
        self.stdout.write(f"Changed: {len(changed)} (title/snippet changes among matched keys)")
        self.stdout.write(f"Report:  {report_path}")

        self.stdout.write("\nTop added domains:")
        for dom, n in added_domains.most_common(top_n):
            if not dom:
                dom = "(unknown)"
            self.stdout.write(f"  {dom}: {n}")

        self.stdout.write("\nTop removed domains:")
        for dom, n in removed_domains.most_common(top_n):
            if not dom:
                dom = "(unknown)"
            self.stdout.write(f"  {dom}: {n}")

        # Optional: write added/removed item lists for inspection
        added_list_path = out_dir / f"added_{before_path.stem}__{after_path.stem}.jsonl"
        removed_list_path = out_dir / f"removed_{before_path.stem}__{after_path.stem}.jsonl"
        changed_list_path = out_dir / f"changed_{before_path.stem}__{after_path.stem}.jsonl"

        with added_list_path.open("w", encoding="utf-8") as f:
            for k in sorted(added_keys, key=lambda x: (x.topic_uuid, x.url)):
                f.write(json.dumps(after[k], ensure_ascii=False) + "\n")

        with removed_list_path.open("w", encoding="utf-8") as f:
            for k in sorted(removed_keys, key=lambda x: (x.topic_uuid, x.url)):
                f.write(json.dumps(before[k], ensure_ascii=False) + "\n")

        with changed_list_path.open("w", encoding="utf-8") as f:
            for k, b, a in sorted(changed, key=lambda x: (x[0].topic_uuid, x[0].url)):
                f.write(
                    json.dumps(
                        {"key": k.__dict__, "before": b, "after": a},
                        ensure_ascii=False,
                    )
                    + "\n"
                )

        self.stdout.write(f"\nWrote lists:\n  {added_list_path}\n  {removed_list_path}\n  {changed_list_path}")
