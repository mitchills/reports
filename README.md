# MM Client Dashboards

One password-protected dashboard per client, monthly historical view.
Live at `https://hub.masteredmarketing.com/reports/[client]/`

## ⚠️ You need TWO repos

This repo is **public**, so it holds only the encrypted pages. The client numbers live
in the **private** `mm-reports-data` repo. Clone both, as siblings:

```
git clone https://github.com/mitchills/reports.git ~/reports
git clone https://github.com/masteredmarketing/mm-reports-data.git ~/mm-reports-data
```

`build.py` finds the data automatically when the two sit side by side. Cloned elsewhere?
Set `MM_REPORTS_DATA=/path/to/mm-reports-data`.

**Why public:** GitHub only serves Pages from a private repo on a paid plan, and the org
is on the free one. **Why not just move this repo into the org:** `hub.masteredmarketing.com`
is a custom domain on the personal `mitchills.github.io` account. Transferring this repo
would change the URL to `masteredmarketing.github.io/reports/` and break every dashboard
link already sent to a client.

## Structure

```
clients.json               the roster — name, slug, seo flag. Add a client here.
src/[client]/index.html    page shell (generated — don't hand-edit, see below)
../mm-reports-data/[client]/data.json    the client's numbers — PRIVATE REPO
docs/assets/dash.css       shared styling — edit once, every client updates
docs/assets/dash.js        shared render logic + keyword selection rules
docs/[client]/index.html   ENCRYPTED build output — this is what Pages serves
scripts/scaffold.py        creates/syncs a folder per client from clients.json
scripts/templates/         the one true page shell
scripts/build.py           inlines data.json into the HTML
scripts/encrypt/           StatiCrypt encryption + the password-gate template
```

**Don't hand-edit `src/[client]/index.html`.** Every client's shell is identical and
regenerated from `scripts/templates/index.html` by `make scaffold` — an edit to one
copy gets overwritten and the other 30 never get it. Change the template instead.

**Why data.json lives in the other repo:** StatiCrypt encrypts an HTML file, but a
`data.json` sitting beside it in a public repo stays plainly readable. `build.py` inlines
the data into the page *before* encryption, so the only published copy of a client's
numbers is inside the encrypted blob. Never commit a `data.json` here.

A client with no data.json is **skipped** at build time, which leaves their already-published
dashboard exactly as it was. Missing data can't blank a live page.

## Monthly update

Pull both repos first, or you'll build on top of someone else's stale numbers.

1. `cd ~/mm-reports-data && git pull` — then `/mm-client-report [client]` appends the new
   month to `[client]/data.json`. Commit + push that repo.
2. `cd ~/reports && git pull && make encrypt` — builds and re-encrypts every client.
3. Commit + push. Pages redeploys in ~60 seconds.

```
make scaffold       create/sync a folder for every client in clients.json
make build          inline data only (no encryption)
make encrypt        build + encrypt everything into docs/
make encrypt-show   print the password table without re-encrypting
make preview        serve docs/ at localhost:8765
```

## Passwords

**A client's password is their slug** — `gladesville` opens
`hub.masteredmarketing.com/reports/gladesville/`. Chosen so an AM can share it on a call.
`make encrypt-show` prints the table.

⚠️ **This is a soft gate, not protection.** The slug is in the public URL and in this
public repo's folder listing, so anyone who finds the repo can open any dashboard. It
keeps the pages out of Google and off casual eyes; it does not keep one client out of
another's numbers. For a client whose figures genuinely can't be seen by anyone else,
add an unguessable password in `mm-reports-data/passwords.json` — overrides survive
`make encrypt`, and living in the shared private repo means the whole team sees the
same password rather than each machine deriving its own.

## Adding a client

Add one line to `clients.json`, then `make scaffold && make encrypt`, commit + push.
The dashboard shows a holding message until that client's first report runs.

```json
{ "slug": "newclinic", "client": "New Clinic Physio", "seo": true }
```

`seo: false` hides the SEO + Keyword Rankings sections entirely for that client — set it
from whether SEO is a service they pay for, not from whether the data happens to exist.

## Changing the shared design

`docs/assets/dash.css` and `dash.js` are loaded by every client page and cached hard by
browsers. After changing either, **bump the `?v=` on both links in
`scripts/templates/index.html`**, then `make scaffold && make encrypt`. Skip it and you'll
be looking at the old design wondering why nothing changed.

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
