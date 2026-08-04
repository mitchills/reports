#!/usr/bin/env python3
"""
Find the client data, which lives OUTSIDE this repo.

Why: this repo is public (GitHub Pages won't serve a private repo on a free org
plan), so the only thing safe to commit here is the StatiCrypt-encrypted output.
A client's raw numbers live in the private repo `masteredmarketing/mm-reports-data`,
cloned as a sibling folder:

    ~/reports/              <- this repo, public, encrypted pages
    ~/mm-reports-data/      <- private, one data.json per client + passwords.json

Resolution order:
  1. $MM_REPORTS_DATA          explicit override (set it if you clone elsewhere)
  2. ../mm-reports-data        the sibling clone (what everyone should have)
  3. ../../mm-reports-data     one level up, for nested checkouts
  4. legacy: src/<client>/data.json inside this repo, gitignored

Legacy exists only so Mitch's original machine keeps working mid-migration.
It is NOT the supported layout and will be dropped once everyone is on the
sibling clone.
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DATA_REPO = "mm-reports-data"
CLONE_HINT = (
    f"  git clone https://github.com/masteredmarketing/{DATA_REPO}.git "
    f"{ROOT.parent / DATA_REPO}"
)


def data_root():
    """The folder holding <client>/data.json, or None if only legacy src/ is available."""
    override = os.environ.get("MM_REPORTS_DATA")
    if override:
        p = Path(override).expanduser().resolve()
        if not p.is_dir():
            print(
                f"ERROR: MM_REPORTS_DATA is set to '{override}' but that folder "
                f"does not exist.\nEither fix it or unset it to use the sibling clone.",
                file=sys.stderr,
            )
            sys.exit(1)
        return p

    for candidate in (ROOT.parent / DATA_REPO, ROOT.parent.parent / DATA_REPO):
        if candidate.is_dir():
            return candidate.resolve()

    return None


def data_file(client: str):
    """Path to one client's data.json, preferring the private repo over legacy src/."""
    root = data_root()
    legacy = ROOT / "src" / client / "data.json"
    if root:
        shared = root / client / "data.json"
        if shared.exists():
            # Both copies present and different means someone edited the old one out
            # of habit and their change is being silently ignored. Say so loudly —
            # a dashboard that quietly publishes last month's numbers is the worst
            # possible failure here.
            if legacy.exists() and legacy.read_bytes() != shared.read_bytes():
                print(
                    f"WARNING: {client} — the leftover copy at {legacy} differs from "
                    f"{shared}.\n         Building from the {DATA_REPO} copy and IGNORING "
                    f"the leftover one.\n         If you meant to edit that client, edit "
                    f"the {DATA_REPO} copy, then delete the leftover.",
                    file=sys.stderr,
                )
            return shared
    return legacy


def passwords_file():
    """Path to passwords.json, preferring the private repo over legacy repo root."""
    root = data_root()
    if root:
        shared = root / "passwords.json"
        if shared.exists():
            return shared
    return ROOT / "passwords.json"


def require_data_or_explain():
    """Fail loudly, with the fix, rather than quietly building nothing.

    The dangerous case is a teammate who cloned only the public repo: without this
    they'd see '0 of 31 built' and have to guess why. (They still can't blank a live
    dashboard — a client with no data.json is skipped, so its published page is left
    exactly as it was — but a clear error beats a confusing one.)
    """
    root = data_root()
    if root:
        return root

    legacy = list((ROOT / "src").glob("*/data.json"))
    if legacy:
        return None  # Mitch's original machine, still fine

    print(
        f"\nERROR: no client data found.\n\n"
        f"The numbers live in the private repo '{DATA_REPO}', which is not on this\n"
        f"machine. Clone it as a sibling of this repo:\n\n{CLONE_HINT}\n\n"
        f"Then run this again. (Cloned somewhere else? Set MM_REPORTS_DATA to that path.)\n",
        file=sys.stderr,
    )
    sys.exit(1)
