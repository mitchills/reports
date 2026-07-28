#!/usr/bin/env python3
"""
Encrypt every built client dashboard with StatiCrypt.

    build/<client>/index.html  ->  docs/<client>/index.html   (served by GitHub Pages)

Password strategy: derived passwords.
  Each client's password = HMAC-SHA256(ENCRYPT_SECRET, "<client>"), base64, 24 chars.
  - One master secret to manage; store it in your password manager
  - Each client gets a unique password — sharing one never exposes another
  - Deterministic, so any password can be regenerated from secret + client name
  - The secret never touches the repo (.env is gitignored)

Usage:
    python3 scripts/encrypt/encrypt_public.py            # encrypt all
    python3 scripts/encrypt/encrypt_public.py --show     # show passwords, encrypt nothing
    python3 scripts/encrypt/encrypt_public.py --client gladesville
"""

import argparse
import base64
import hashlib
import hmac
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

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


def derive_password(secret: str, client: str) -> str:
    digest = hmac.new(secret.encode(), client.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest)[:24].decode("ascii")


def encrypt(src: Path, out_dir: Path, password: str) -> bool:
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = ["npx", "--yes", "staticrypt", str(src),
           "--password", password, "-d", str(out_dir), "--short",
           "--config", CONFIG]
    if TEMPLATE.exists():
        cmd += ["--template", str(TEMPLATE)]
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT)
    if r.returncode != 0:
        print(f"    staticrypt error: {r.stderr.strip()}", file=sys.stderr)
        return False
    return True


def table(passwords, results=None):
    print()
    print(f"  {'Client':<24} {'Password':<26} URL")
    print(f"  {'-'*24} {'-'*26} {'-'*44}")
    for name, pwd in passwords.items():
        status = f"  [{results[name]}]" if results else ""
        url = f"hub.masteredmarketing.com/reports/{name}/"
        print(f"  {name:<24} {pwd:<26} {url}{status}")
    print()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--show", action="store_true")
    ap.add_argument("--client")
    args = ap.parse_args()

    secret = os.environ.get("ENCRYPT_SECRET", "")
    if not secret:
        print("ERROR: ENCRYPT_SECRET is not set (expected in .env).", file=sys.stderr)
        sys.exit(1)

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

    passwords = {n: derive_password(secret, n) for n in names}

    if args.show:
        print("\nClient dashboard passwords (derived from ENCRYPT_SECRET):")
        table(passwords)
        return

    print(f"\nEncrypting {len(names)} dashboard(s): build/ -> docs/\n")
    results = {}
    for n in names:
        print(f"  {n} ...", end=" ", flush=True)
        ok = encrypt(BUILD / n / "index.html", OUTPUT / n, passwords[n])
        results[n] = "OK" if ok else "FAILED"
        print(results[n])

    print("\nShare each password only with that client:")
    table(passwords, results)

    if any(v != "OK" for v in results.values()):
        sys.exit(1)


if __name__ == "__main__":
    main()
