# MM Client Dashboards

One password-protected dashboard per client, monthly historical view.
Live at `https://hub.masteredmarketing.com/reports/[client]/`

## Structure

```
src/[client]/index.html    page shell (committed)
src/[client]/data.json     the client's numbers — GITIGNORED, never pushed
docs/assets/dash.css       shared styling — edit once, every client updates
docs/assets/dash.js        shared render logic + keyword selection rules
docs/[client]/index.html   ENCRYPTED build output — this is what Pages serves
scripts/build.py           inlines data.json into the HTML
scripts/encrypt/           StatiCrypt encryption + the password-gate template
```

**Why data.json is gitignored:** StatiCrypt encrypts an HTML file, but a `data.json`
sitting beside it in a public repo stays plainly readable. `build.py` inlines the data
into the page *before* encryption, so the only published copy of a client's numbers is
inside the encrypted blob. Never commit `src/*/data.json`.

## Monthly update

1. `/mm-client-report [client]` appends the new month to `src/[client]/data.json`
2. `make encrypt` — builds and re-encrypts every client
3. Commit + push. Pages redeploys in ~60 seconds.

```
make build          inline data only (no encryption)
make encrypt        build + encrypt everything into docs/
make encrypt-show   print the password table without re-encrypting
make preview        serve docs/ at localhost:8765
```

## Passwords

Each client's password is derived: `HMAC-SHA256(ENCRYPT_SECRET, client-name)`, 24 chars.
One master secret in `.env` (gitignored, never committed) generates a unique password per
client, so sharing one client's password never exposes another. Passwords are deterministic
— `make encrypt-show` regenerates them any time.

**Store `ENCRYPT_SECRET` in your password manager.** Lose it and every password changes.

## Adding a client

Copy any `src/[client]/` folder, rename it, replace `data.json`, run `make encrypt`.

## Data rules

- **A number you didn't pull is `null`, never `0`.** Renders as "no data". A zero claims
  nothing happened, which is a different and usually false statement.
- Months accumulate in `months[]` — never overwrite a prior month, the toggle is the
  client's history. Store absolute values; deltas are computed against the preceding month.
- Keyword `movement` = position at month start − month end. A keyword not tracked at month
  start is `is_new` and must never be reported as a gain.
- Filter booking-funnel paths (`/guest/*`, `/account/*`) out of `top_pages`.

## Sources

Google + Meta Ads via the `adkit` CLI · GA4 via the analytics MCP · Search Console via the
gsc MCP · keyword rankings via the SE Ranking MCP (live, never a PDF export).
