#!/usr/bin/env python3
"""
Encrypt every built client dashboard with StatiCrypt.

    build/<client>/index.html  ->  docs/<client>/index.html   (served by GitHub Pages)

Password strategy: the client's own slug, lowercase (gladesville -> "gladesville").
  Chosen for shareability — the AM can say it on a call without a password manager.

  ⚠️ This is a soft gate, not real protection. The slug is also in the public URL and
  in this public repo's folder listing, so anyone who finds the repo can open any
  dashboard. It keeps the pages out of search results and off casual eyes; it does
  NOT keep one client out of another client's numbers. Put a genuinely sensitive
  client in passwords.json with something unguessable instead.

Usage:
    python3 scripts/encrypt/encrypt_public.py            # encrypt all
    python3 scripts/encrypt/encrypt_public.py --show     # show passwords, encrypt nothing
    python3 scripts/encrypt/encrypt_public.py --client gladesville
"""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

# On Windows npx is npx.cmd, and CreateProcess does not apply PATHEXT — a bare
# ["npx", ...] raises WinError 2 even though npx is on PATH. Resolve it up front;
# shutil.which returns the plain path on macOS/Linux, so behaviour is unchanged there.
NPX = shutil.which("npx") or "npx"

ROOT = Path(__file__).resolve().parent.parent.parent

sys.path.insert(0, str(ROOT / "scripts"))
from datapath import passwords_file  # noqa: E402

_env = ROOT / ".env"
if _env.exists():
    for _line in _env.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _, _v = _line.partition("=")
            os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

BUILD    = ROOT / "build"
OUTPUT   = ROOT / "docs"
TEMPLATE = Path(__file__).parent / "template.html"
# staticrypt resolves --config relative to cwd and prefixes "./", so an absolute
# path breaks it. Keep it relative and run the subprocess from ROOT.
CONFIG   = ".staticrypt.json"


def load_overrides() -> dict:
    """Per-client password overrides, e.g. {"redlands": "8Kq2-vTn"}.
    Lives in the private mm-reports-data repo (never in this public one), so the
    whole team sees the same passwords. Anything listed here wins over the default slug password, and
    survives `make encrypt` — otherwise a custom password gets silently
    clobbered the next time everything is re-encrypted. Use this for any client
    whose numbers shouldn't be openable by anyone holding the URL."""
    overrides_file = passwords_file()
    if not overrides_file.exists():
        return {}
    try:
        import json
        return json.loads(overrides_file.read_text())
    except Exception as e:
        print(f"WARNING: could not read passwords.json ({e}) — using derived passwords.",
              file=sys.stderr)
        return {}


def password_for(client: str, overrides: dict) -> tuple:
    """Returns (password, is_custom). Default = the client's own slug."""
    if client in overrides and overrides[client]:
        return str(overrides[client]), True
    return client.lower(), False


def encrypt(src: Path, out_dir: Path, password: str) -> bool:
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [NPX, "--yes", "staticrypt", str(src),
           "--password", password, "-d", str(out_dir), "--short",
           "--config", CONFIG]
    if TEMPLATE.exists():
        cmd += ["--template", str(TEMPLATE)]
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT)
    if r.returncode != 0:
        print(f"    staticrypt error: {r.stderr.strip()}", file=sys.stderr)
        return False
    return True


def table(passwords, custom=None, results=None):
    custom = custom or {}
    print()
    print(f"  {'Client':<24} {'Password':<26} {'Type':<9} URL")
    print(f"  {'-'*24} {'-'*26} {'-'*9} {'-'*44}")
    for name, pwd in passwords.items():
        status = f"  [{results[name]}]" if results else ""
        kind = "custom" if custom.get(name) else "slug"
        url = f"hub.masteredmarketing.com/reports/{name}/"
        print(f"  {name:<24} {pwd:<26} {kind:<9} {url}{status}")
    print()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--show", action="store_true")
    ap.add_argument("--client")
    args = ap.parse_args()

    if args.show:
        names = sorted(d.name for d in (ROOT / "src").iterdir() if d.is_dir())
    else:
        if not BUILD.exists():
            print("ERROR: build/ does not exist — run `make build` first.", file=sys.stderr)
            sys.exit(1)
        names = sorted(d.name for d in BUILD.iterdir() if d.is_dir())

    if args.client:
        names = [n for n in names if n == args.client]
        if not names:
            print(f"ERROR: '{args.client}' not found.", file=sys.stderr)
            sys.exit(1)

    if not names:
        print("Nothing to encrypt.")
        sys.exit(0)

    overrides = load_overrides()
    resolved  = {n: password_for(n, overrides) for n in names}
    passwords = {n: p for n, (p, _) in resolved.items()}
    custom    = {n: c for n, (_, c) in resolved.items()}

    if args.show:
        print("\nClient dashboard passwords:")
        table(passwords, custom)
        return

    print(f"\nEncrypting {len(names)} dashboard(s): build/ -> docs/\n")
    results = {}
    for n in names:
        print(f"  {n} ...", end=" ", flush=True)
        ok = encrypt(BUILD / n / "index.html", OUTPUT / n, passwords[n])
        results[n] = "OK" if ok else "FAILED"
        print(results[n])

    print("\nShare each password only with that client:")
    table(passwords, custom, results)

    if any(v != "OK" for v in results.values()):
        sys.exit(1)


if __name__ == "__main__":
    main()
