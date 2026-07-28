#!/usr/bin/env python3
"""
Create (and keep in sync) one dashboard folder per client listed in clients.json.

    src/<slug>/index.html   always rewritten from scripts/templates/index.html
    src/<slug>/data.json    created ONLY if missing — never overwritten

The asymmetry is deliberate. index.html is identical for every client, so it must
be regenerated or 30 copies drift apart the moment the shell changes. data.json is
the client's accumulated history and the only copy that exists (it's gitignored),
so this script will not touch one that already exists.

Usage:
    python3 scripts/scaffold.py            # create/sync everything
    python3 scripts/scaffold.py --dry-run  # show what would change
"""

import argparse
import json
import sys
from pathlib import Path

ROOT     = Path(__file__).resolve().parent.parent
ROSTER   = ROOT / "clients.json"
TEMPLATE = ROOT / "scripts" / "templates" / "index.html"
SRC      = ROOT / "src"


def starter_data(entry: dict) -> dict:
    """An empty dashboard. months[] stays empty until the first report runs —
    the page shows a holding message rather than a wall of zeros, because a zero
    would claim the month happened and produced nothing."""
    return {
        "client": entry["client"],
        "slug": entry["slug"],
        "seo": entry.get("seo", True),
        "updated_at": None,
        "months": [],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not TEMPLATE.exists():
        print(f"ERROR: template missing at {TEMPLATE}", file=sys.stderr)
        sys.exit(1)

    roster = json.loads(ROSTER.read_text())["clients"]
    shell  = TEMPLATE.read_text()

    slugs = [c["slug"] for c in roster]
    dupes = {s for s in slugs if slugs.count(s) > 1}
    if dupes:
        print(f"ERROR: duplicate slugs in clients.json: {sorted(dupes)}", file=sys.stderr)
        sys.exit(1)

    created, synced, kept = [], [], []

    for entry in roster:
        slug = entry["slug"]
        d    = SRC / slug
        data = d / "data.json"
        page = d / "index.html"

        is_new = not data.exists()
        shell_stale = not page.exists() or page.read_text() != shell

        if args.dry_run:
            if is_new:           created.append(slug)
            elif shell_stale:    synced.append(slug)
            else:                kept.append(slug)
            continue

        d.mkdir(parents=True, exist_ok=True)
        if shell_stale:
            page.write_text(shell)

        if is_new:
            data.write_text(json.dumps(starter_data(entry), indent=2) + "\n")
            created.append(slug)
        elif shell_stale:
            synced.append(slug)
        else:
            kept.append(slug)

    verb = "would create" if args.dry_run else "created"
    print(f"\n{verb}: {len(created)}   shell re-synced: {len(synced)}   unchanged: {len(kept)}")
    if created: print(f"  new:    {', '.join(created)}")
    if synced:  print(f"  synced: {', '.join(synced)}")
    print("\nNext: make encrypt   then commit + push.\n")


if __name__ == "__main__":
    main()
