#!/usr/bin/env python3
"""
Inline each client's data.json into their index.html, ready for encryption.

Why this exists: StatiCrypt encrypts an HTML file, but a separate data.json sitting
beside it in the repo stays plainly readable. Inlining the data means the ONLY
published copy of a client's numbers is inside the encrypted blob.

  src/<client>/index.html + <data repo>/<client>/data.json  ->  build/<client>/index.html

The page shells live here; the numbers live in the private repo mm-reports-data,
because this repo is public. See scripts/datapath.py for how that folder is found.

Usage:
    python3 scripts/build.py              # build every client
    python3 scripts/build.py gladesville  # build one
"""

import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from datapath import data_file, data_root, require_data_or_explain  # noqa: E402

ROOT  = Path(__file__).resolve().parent.parent
SRC   = ROOT / "src"
BUILD = ROOT / "build"

# Matches the dash.js tag with or without a ?v= cache-buster, so bumping the
# version in the shell can't silently break every build.
MARKER_RE = re.compile(r'<script src="\.\./assets/dash\.js(?:\?[^"]*)?"></script>')


def build_client(client_dir: Path) -> bool:
    name = client_dir.name
    html_path = client_dir / "index.html"
    data_path = data_file(name)

    if not html_path.exists():
        print(f"  {name:<20} SKIP  (no index.html)")
        return False
    if not data_path.exists():
        # Skipping leaves this client's already-published page untouched, which is
        # what we want — never blank a live dashboard just because data is missing.
        print(f"  {name:<20} SKIP  (no data.json — nothing to publish)")
        return False

    try:
        data = json.loads(data_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"  {name:<20} FAIL  (invalid data.json: {e})")
        return False

    html = html_path.read_text(encoding="utf-8")
    marker = MARKER_RE.search(html)
    if not marker:
        print(f"  {name:<20} FAIL  (could not find the dash.js script tag to inline before)")
        return False

    # </script> inside a string would close the tag early — escape it
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    inline = f'<script>window.__DASH_DATA__ = {payload};</script>\n{marker.group(0)}'
    html = html[:marker.start()] + inline + html[marker.end():]

    out_dir = BUILD / name
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "index.html").write_text(html, encoding="utf-8")

    months = ", ".join(m.get("label", "?") for m in data.get("months", []))
    print(f"  {name:<20} OK    ({months})")
    return True


def main():
    if not SRC.exists():
        print(f"ERROR: {SRC} does not exist.", file=sys.stderr)
        sys.exit(1)

    only = sys.argv[1] if len(sys.argv) > 1 else None
    clients = sorted(d for d in SRC.iterdir() if d.is_dir())
    if only:
        clients = [d for d in clients if d.name == only]
        if not clients:
            print(f"ERROR: no client folder named '{only}' in src/", file=sys.stderr)
            sys.exit(1)

    if BUILD.exists() and not only:
        shutil.rmtree(BUILD)

    resolved = require_data_or_explain()
    where = resolved if resolved else f"{SRC} (legacy in-repo data)"
    print(f"\nInlining data for {len(clients)} client(s)\n  data: {where}\n  out:  {BUILD}\n")
    built = sum(build_client(c) for c in clients)
    print(f"\n{built} of {len(clients)} built.\n")
    if built == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
