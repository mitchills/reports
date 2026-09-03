/* Mastered Marketing — client performance dashboard
   Monthly historical view. One data.json per client.
   Rule: a missing number renders as "no data", NEVER as zero. */

let DATA = null;

/* Keyword facet selection. Only used by clients whose rankings carry `location`
   and/or `cluster` (e.g. a multi-site clinic tracking the same term in several
   postcodes). Selection persists while the month toggle is used, and falls back
   to ALL when the chosen value is absent from the month being shown. */
const KW_ALL = 'All';
let KW_LOC = KW_ALL, KW_CLUSTER = KW_ALL;

/* ─── formatters ─── */
const aud  = n => '$' + Math.round(n).toLocaleString('en-AU');
const aud2 = n => '$' + n.toFixed(2);
const num  = n => Math.round(n).toLocaleString('en-AU');
const has  = v => v !== null && v !== undefined;

/* delta vs the preceding month.
   higherIsBetter: true = up is good, false = up is bad (cost), null = neutral */
function delta(curr, prev, higherIsBetter) {
  if (!has(curr) || !has(prev) || prev === 0) return { cls:'delta-flat', str:'—' };
  const d = (curr - prev) / prev;
  const str = (d >= 0 ? '↑ +' : '↓ ') + Math.round(Math.abs(d) * 100) + '%';
  if (Math.abs(d) < 0.005)      return { cls:'delta-flat', str:'—' };
  if (higherIsBetter === null)  return { cls:'delta-flat', str };
  if (d > 0) return { cls: higherIsBetter ? 'delta-up'   : 'delta-cost-up',   str };
             return { cls: higherIsBetter ? 'delta-down' : 'delta-cost-down', str };
}

/* One sub-line slot under every value, so a percentage and a static note (e.g.
   "4,107 in top 10") land on the SAME baseline instead of stacking. A real delta
   wins the slot; otherwise the note takes it; otherwise the slot renders empty.
   The old '—' placeholder is deliberately dropped — it filled the row with dashes
   that carried no information and only pushed the layout around. */
function kpiHTML(label, value, d, note) {
  const real = d && d.str && d.str !== '—';
  const sub = real ? `<div class="kpi-delta ${d.cls}">${d.str}</div>`
            : note ? `<div class="kpi-delta kpi-note">${note}</div>`
            : '<div class="kpi-delta"></div>';
  return `<div class="kpi">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value">${value}</div>
    ${sub}
  </div>`;
}
const emptyPanel = msg => `<div class="empty">${msg}</div>`;

/* ─── SUMMARY — the one line that tells the client whether the month was good.
   Written by the report skill into `summary`, because the framing needs judgement
   the dashboard can't apply. Hidden when absent rather than auto-generated:
   a machine-written verdict on a soft month is exactly how you roast yourself. ─── */
function renderSummary(m) {
  const wrap = document.getElementById('summary');
  if (!m.summary) { wrap.innerHTML = ''; wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  wrap.innerHTML = `<div class="summary-band">${m.summary}</div>`;
}

/* ─── 0. BUSINESS RESULTS — clinic-supplied, not pullable from any ad platform.
   Cost per patient is DERIVED from real ad spend ÷ patients the clinic confirmed,
   so it only appears when the clinic has actually given us the number. ─── */
function renderBusiness(m, prev) {
  const el = document.getElementById('business');
  const b = m.business, pb = prev && prev.business;
  /* optional section — hidden entirely unless the clinic has supplied figures */
  const wrap = document.getElementById('business-section');
  if (!b) { if (wrap) wrap.style.display = 'none'; el.innerHTML = ''; return; }
  if (wrap) wrap.style.display = '';

  const paidSpend = mo => {
    if (!mo) return null;
    const g = mo.google_ads, mt = mo.meta_ads;
    if (!g && !mt) return null;
    return (g && g.spend || 0) + (mt && mt.spend || 0);
  };
  const spend = paidSpend(m), pspend = paidSpend(prev);
  const cpp  = (has(spend)  && has(b.patients_from_ads)  && b.patients_from_ads  > 0)
             ? spend / b.patients_from_ads : null;
  const pcpp = (has(pspend) && pb && has(pb.patients_from_ads) && pb.patients_from_ads > 0)
             ? pspend / pb.patients_from_ads : null;

  const c = (label, value, d) => `<div class="card">
      <div class="card-label">${label}</div>
      <div class="card-value">${value}</div>
      <div class="card-delta ${d.cls}">${d.str}</div>
    </div>`;
  const v = (x, fmt) => has(x) ? fmt(x) : '<span class="na">no data</span>';

  let out = '<div class="card-row">' +
    c('Appointments',    v(b.appointments,      num), delta(b.appointments,      pb && pb.appointments,      true)) +
    c('New patients',    v(b.new_patients,      num), delta(b.new_patients,      pb && pb.new_patients,      true)) +
    c('Patients from ads', v(b.patients_from_ads, num), delta(b.patients_from_ads, pb && pb.patients_from_ads, true)) +
    c('Cost per patient', v(cpp, aud2),               delta(cpp, pcpp, false)) +
    '</div>';

  /* estimated return — only when the clinic has given us a customer value */
  if (has(b.avg_customer_value) && has(b.patients_from_ads)) {
    const est = b.avg_customer_value * b.patients_from_ads;
    out += `<div class="table-note">Estimated value of ads-driven patients:
      <strong>${aud(est)}</strong> — ${num(b.patients_from_ads)} patients at the clinic's
      average customer value of ${aud(b.avg_customer_value)}${has(spend)
        ? `, against ${aud(spend)} of ad spend` : ''}.</div>`;
  }
  out += '<div class="source-note">Supplied by the clinic — not measurable from the ad platforms.</div>';
  el.innerHTML = out;
}

/* ─── 1. PAID — big total cards with the Google/Meta split as pills ─── */
function renderPaid(m, prev) {
  const el = document.getElementById('paid');
  const g = m.google_ads, mt = m.meta_ads;
  const pg = prev && prev.google_ads, pm = prev && prev.meta_ads;
  if (!g && !mt) { el.innerHTML = emptyPanel('No paid advertising data recorded for this month.'); return; }

  /* total = sum of whatever platforms reported; cost/conv recalculated, never averaged */
  const tot = (a, b) => {
    if (!a && !b) return null;
    const spend = (a && a.spend || 0) + (b && b.spend || 0);
    const conv  = (a && a.conversions || 0) + (b && b.conversions || 0);
    return { spend, conversions: conv, cpa: conv > 0 ? spend / conv : null };
  };
  const t = tot(g, mt), pt = tot(pg, pm);

  /* one big card: total value + delta, split pills underneath */
  const card = (label, key, fmt, better, extra, pills2) => {
    const val = t && t[key];
    const d   = delta(val, pt && pt[key], better);
    /* Each platform carries its own prior-month value so the pill can show whether
       THAT platform moved. The card total alone hides an offsetting split — Meta up
       and Google down can net to "flat", which reads as nothing happening. */
    const split = [
      { name:'Google', v: g  && g[key],  p: pg && pg[key] },
      { name:'Meta',   v: mt && mt[key], p: pm && pm[key] }
    ].filter(s => has(s.v));
    return `<div class="card">
      <div class="card-label">${label}</div>
      <div class="card-value">${has(val) ? fmt(val) : '<span class="na">no data</span>'}</div>
      <div class="card-delta ${d.cls}">${d.str}${extra || ''}</div>
      <div class="split">${split.map(s => {
        const sd = delta(s.v, s.p, better);
        const real = sd.str && sd.str !== '—';
        return `<span class="split-pill"><b>${fmt(s.v)}</b> ${s.name}` +
               (real ? `<i class="split-delta ${sd.cls}">${sd.str}</i>` : '') +
               '</span>';
      }).join('')}</div>
      ${pills2 || ''}
    </div>`;
  };

  /* OPTIONAL conversion-type split — platforms may carry `conversions_by_type`
     (e.g. {"Bookings": 30, "Enquiries": 4}) and it is summed across them, so a
     clinic can see appointments booked apart from people still just asking.
     Rendered ONLY when the types reconcile to the conversions total: a partial
     split reads as if the unaccounted conversions never happened, which is worse
     than showing no split at all. Absent on every client that doesn't set it. */
  const typePills = () => {
    const acc = {};
    [g, mt].forEach(p => {
      const byType = p && p.conversions_by_type;
      if (byType) for (const k in byType) if (has(byType[k])) acc[k] = (acc[k] || 0) + byType[k];
    });
    const names = Object.keys(acc);
    if (!names.length || !t) return '';
    if (names.reduce((n, k) => n + acc[k], 0) !== t.conversions) return '';
    return `<div class="split">${names.map(k =>
      `<span class="split-pill"><b>${num(acc[k])}</b> ${k}</span>`).join('')}</div>`;
  };

  let targetTag = '';
  if (t && has(t.cpa) && has(DATA.target_cpa)) {
    const under = t.cpa <= DATA.target_cpa;
    targetTag = ` <span class="tag ${under ? 'tag-good' : 'tag-bad'}">${under ? 'under' : 'over'} $${DATA.target_cpa} target</span>`;
  }

  el.innerHTML = '<div class="card-row">' +
    card('Conversions',         'conversions', num,  true,  '', typePills()) +
    card('Cost per conversion', 'cpa',         aud2, false, targetTag) +
    card('Spend',               'spend',       aud,  null)  +
    '</div>';
}

/* ─── 1b. PAID BY SERVICE — optional. Multi-service clinics (e.g. a clinic running
   Chiro/Physio/Podiatry as separate campaigns) get a per-service breakdown under the
   account-wide Paid card. Hidden entirely for clients without a `services` block —
   the section div exists in every client's shell so the shared JS never hits a
   missing element, but stays display:none until data shows up. ─── */
function renderServices(m, prev) {
  const wrap = document.getElementById('services-section');
  const el   = document.getElementById('services');
  if (!wrap || !el) return;               // defensive — shell out of date
  const services = m.services, pServices = prev && prev.services;

  if (!services || !Object.keys(services).length) {
    wrap.style.display = 'none'; el.innerHTML = '';
    return;
  }
  wrap.style.display = '';

  const tot = (a, b) => {
    if (!a && !b) return null;
    const spend = (a && a.spend || 0) + (b && b.spend || 0);
    const conv  = (a && a.conversions || 0) + (b && b.conversions || 0);
    return { spend, conversions: conv, cpa: conv > 0 ? spend / conv : null };
  };

  el.innerHTML = Object.keys(services).map(name => {
    const svc  = services[name];
    const psvc = pServices && pServices[name];
    const g = svc.google_ads, mt = svc.meta_ads;
    const pg = psvc && psvc.google_ads, pm = psvc && psvc.meta_ads;
    const t = tot(g, mt), pt = tot(pg, pm);
    if (!t) return '';

    const card = (label, key, fmt, better) => {
      const val = t[key];
      const d   = delta(val, pt && pt[key], better);
      /* Each platform carries its OWN month-on-month change, not just the combined
         total — a location can hold steady overall while Google and Meta move in
         opposite directions, and that is exactly the thing worth acting on. */
      const split = [
        { name:'Google', v: g  && g[key],  p: pg && pg[key] },
        { name:'Meta',   v: mt && mt[key], p: pm && pm[key] }
      ].filter(s => has(s.v));
      return `<div class="card">
        <div class="card-label">${label}</div>
        <div class="card-value">${has(val) ? fmt(val) : '<span class="na">no data</span>'}</div>
        <div class="card-delta ${d.cls}">${d.str}</div>
        <div class="split">${split.map(s => {
          const sd = delta(s.v, s.p, better);
          const real = sd.str && sd.str !== '—';
          return `<span class="split-pill"><b>${fmt(s.v)}</b> ${s.name}` +
                 (real ? `<i class="split-delta ${sd.cls}">${sd.str}</i>` : '') +
                 '</span>';
        }).join('')}</div>
      </div>`;
    };

    return `<div class="sub-label">${name}</div>
      <div class="card-row">
        ${card('Conversions',         'conversions', num,  true)}
        ${card('Cost per conversion', 'cpa',         aud2, false)}
        ${card('Spend',               'spend',       aud,  null)}
      </div>`;
  }).join('');
}

/* ─── 2. WEBSITE (GA4) — three separate panels so traffic, conversions and pages
   don't read as one undifferentiated block ─── */
function renderSite(m, prev) {
  const g = m.ga4, p = prev && prev.ga4;
  const trafficEl = document.getElementById('site-traffic');
  const convEl    = document.getElementById('site-conversions');
  const pagesEl   = document.getElementById('site-pages');
  const convBlock  = document.getElementById('site-conv-block');
  const pagesBlock = document.getElementById('site-pages-block');
  const show = (blk, on) => { if (blk) blk.style.display = on ? '' : 'none'; };

  if (!g) {
    trafficEl.innerHTML = emptyPanel('No website analytics recorded for this month.');
    show(convBlock, false); show(pagesBlock, false);
    return;
  }

  const bigCard = (label, value, d) => `<div class="card">
      <div class="card-label">${label}</div>
      <div class="card-value">${value}</div>
      <div class="card-delta ${d.cls}">${d.str}</div>
    </div>`;

  /* organic traffic lives in the SEO strip, not here — no duplicate */
  trafficEl.innerHTML = '<div class="card-row">' +
    bigCard('Sessions',        has(g.sessions) ? num(g.sessions) : '<span class="na">no data</span>',
            delta(g.sessions, p && p.sessions, true)) +
    bigCard('Conversions',     has(g.conversions) ? num(g.conversions) : '<span class="na">no data</span>',
            delta(g.conversions, p && p.conversions, true)) +
    bigCard('Engagement rate', has(g.engagement_rate) ? (g.engagement_rate * 100).toFixed(1) + '%'
                                                      : '<span class="na">no data</span>',
            delta(g.engagement_rate, p && p.engagement_rate, true)) +
    '</div>' +
    /* Optional plain-English line under the traffic cards, set per month as
       `traffic_note` in that client's data.json. Same contract as `organic_note`:
       purely additive, absent on every other client. Sessions and conversions
       moving together usually means a spend change, not a website problem — say
       which, because a red arrow with no explanation reads as bad news either way.
       Never assert a cause we have not established. */
    (m.traffic_note ? `<div class="table-note">${m.traffic_note}</div>` : '');

  /* comparison column: match rows to last month by name */
  const cmp = (val, prevVal, better) => {
    const d = delta(val, prevVal, better);
    return `<td class="r"><span class="${d.cls}">${d.str}</span></td>`;
  };

  const hasConv = g.conversion_breakdown && g.conversion_breakdown.length;
  show(convBlock, hasConv);
  if (hasConv) {
    const prevBy = {};
    ((p && p.conversion_breakdown) || []).forEach(c => prevBy[c.name] = c.value);
    convEl.innerHTML = '<table class="tbl"><thead><tr><th>Conversion type</th>' +
           '<th class="r">Count</th><th class="r">vs last month</th></tr></thead><tbody>' +
      g.conversion_breakdown.map(c =>
        `<tr><td>${c.name}</td><td class="r">${num(c.value)}</td>` +
        cmp(c.value, prevBy[c.name], true) + '</tr>').join('') +
      '</tbody></table>';
  }

  /* traffic_by_channel is kept in data.json for AM diagnostics but deliberately NOT
     rendered — it isn't actionable for a client, and GA4's "Unassigned" / "Paid Other"
     buckets are attribution artefacts that invite questions with no good answer. */

  const hasPages = g.top_pages && g.top_pages.length;
  show(pagesBlock, hasPages);
  if (hasPages) {
    const prevPages = {};
    ((p && p.top_pages) || []).forEach(x => prevPages[x.page] = x.views);
    pagesEl.innerHTML = '<table class="tbl"><thead><tr><th>Page</th>' +
           '<th class="r">Views</th><th class="r">vs last month</th></tr></thead><tbody>' +
      g.top_pages.slice(0, 10).map(pg =>
        `<tr><td class="page-path">${pg.page}</td><td class="r">${num(pg.views)}</td>` +
        cmp(pg.views, prevPages[pg.page], true) + '</tr>').join('') +
      '</tbody></table>';
  }
}

/* ─── 3. SEO ─── */
function renderSeo(m, prev) {
  const o = m.organic, po = prev && prev.organic;
  const s = m.search, ps = prev && prev.search;
  const el = document.getElementById('organic');

  if (!o && !s) {
    el.innerHTML = emptyPanel('No organic search data recorded for this month.');
  } else {
    /* keywords_ranking = total organic keywords the site ranks for (SE Ranking domain
       index). Only shown when captured for that month — it's a live snapshot, so never
       backfill an older month with today's figure. */
    const kw = s && s.keywords_ranking, pkw = ps && ps.keywords_ranking;
    /* A tile with no source is HIDDEN, not dashed. Three of these come only from
       Search Console, and a client we have no GSC access for was rendering a row of
       em-dashes that read as broken rather than as absent. Where SE Ranking holds a
       genuine equivalent it gets its OWN tile and its own label — never the GSC
       label, because "Avg. position" from tracked keywords and from Search Console
       are different measures and must not be read as the same number. */
    const tile = (label, val, d, note) => has(val) ? kpiHTML(label, val, d, note) : '';
    el.innerHTML = '<div class="kpi-row strip">' +
      tile('Organic sessions', (o && has(o.sessions)) ? num(o.sessions) : null,
              delta(o && o.sessions, po && po.sessions, true)) +
      tile('Search impressions', (s && has(s.impressions)) ? num(s.impressions) : null,
              delta(s && s.impressions, ps && ps.impressions, true)) +
      /* lower position number = better, so this delta is inverted */
      tile('Avg. position', (s && has(s.avg_position)) ? s.avg_position.toFixed(1) : null,
              delta(s && s.avg_position, ps && ps.avg_position, false)) +
      tile('Avg. position (tracked)',
              (s && has(s.avg_position_tracked)) ? s.avg_position_tracked.toFixed(1) : null,
              delta(s && s.avg_position_tracked, ps && ps.avg_position_tracked, false),
              'across tracked keywords') +
      (has(kw) ? kpiHTML('Keywords ranking', num(kw), delta(kw, pkw, true),
              (s && has(s.keywords_top10)) ? `${num(s.keywords_top10)} in top 10` : '') : '') +
      tile('Pages ranking', (s && has(s.ranked_pages)) ? num(s.ranked_pages) : null,
              delta(s && s.ranked_pages, ps && ps.ranked_pages, true)) +
      tile('Pages indexed', (s && has(s.pages_indexed)) ? num(s.pages_indexed) : null,
              delta(s && s.pages_indexed, ps && ps.pages_indexed, true), 'in Google') +
      '</div>' +
      /* Optional plain-English line under the SEO strip, set per month as
         `organic_note` in that client's data.json. Purely additive and opt-in:
         absent on every other client, so their pages render exactly as before.
         Use it to say WHERE a movement sits — which page, which share of the
         total. Never to assert a CAUSE we have not proven; an unexplained
         movement is a question, and saying so is more trustworthy than a
         tidy story that turns out to be wrong. */
      (m.organic_note ? `<div class="table-note">${m.organic_note}</div>` : '');
  }

  /* Which keywords make the cut. A keyword earns its place by RANKING WELL,
     GAINING GROUND, HOLDING a respectable position, or being a NEW WIN —
     never by dropping. Drops are still shown honestly on keywords that
     qualified some other way, we just never surface a keyword because it fell.

     Any gain counts, not just a big one: a keyword that climbed a single spot
     is progress worth showing, while the "big jump" tag stays at >= JUMP so
     the standout movers still read as standouts.

     HELD_POS extends the range down to #30 so steady mid-page commercial terms
     appear, but only where they did NOT fall — otherwise widening the range
     would smuggle decliners onto the page through the back door, which is the
     one thing this rule exists to prevent. */
  const kwEl   = document.getElementById('rankings');
  const tracked = m.rankings || [];
  const all     = tracked.filter(r => has(r.position) && r.position > 0);

  /* PER-CLIENT OPT-IN (DATA.rankings_show_all, set in that client's data.json).
     When on, the panel lists EVERY tracked keyword a page at a time instead of the
     curated slice below — including the ones that fell and the ones holding no
     top-100 position at all. Absent or false keeps the original behaviour, which
     is what every other client's dashboard still renders. Only turn it on for a
     client who has agreed to see the full list: on most accounts a third or more
     of tracked keywords do not rank yet, and a wall of "Not in top 100" reads as
     failure rather than as scope. */
  const showAll = !!(DATA && DATA.rankings_show_all);

  if (!tracked.length || (!showAll && !all.length)) {
    kwEl.innerHTML = emptyPanel('No keyword ranking data recorded for this month.');
    return;
  }

  /* FACETS — opt-in per client via DATA.rankings_facets. When on, rankings that
     carry `location` (a postcode/clinic) or `cluster` (a service group) get a row
     of filter chips each. Deliberately NOT auto-detected off the fields alone:
     a client can carry cluster tags for reporting without wanting the filter on
     their page, so switching it on stays a decision, not a side effect. */
  const showFacets = !!(DATA && DATA.rankings_facets);
  /* Label for the location chip row. Defaults to 'Postcode' (Elite HP tracks by
     postcode); clients tracking suburbs or clinics override via facet_labels. */
  const LOC_LABEL = (DATA && DATA.facet_labels && DATA.facet_labels.location) || 'Postcode';
  /* Label for the cluster chip row. Defaults to 'Service' (a dental or allied-health
     clinic groups keywords by treatment); clients grouping by topic or programme
     type override via facet_labels.cluster. */
  const CLU_LABEL = (DATA && DATA.facet_labels && DATA.facet_labels.cluster) || 'Service';
  const facetVals = key => !showFacets ? []
    : [...new Set(tracked.map(r => r[key]).filter(Boolean))].sort();
  const locs = facetVals('location'), clusters = facetVals('cluster');
  /* A term tracked in more than one location yields one row per location, which
     reads as a duplicate while the location chip is on ALL. Tag just those rows
     with their location so two different positions for one term make sense. */
  const seenIn = new Map();
  tracked.forEach(r => {
    if (!r.location) return;
    if (!seenIn.has(r.keyword)) seenIn.set(r.keyword, new Set());
    seenIn.get(r.keyword).add(r.location);
  });
  const multiLoc = new Set([...seenIn].filter(([, s]) => s.size > 1).map(([k]) => k));
  if (KW_LOC !== KW_ALL && !locs.includes(KW_LOC))         KW_LOC = KW_ALL;
  if (KW_CLUSTER !== KW_ALL && !clusters.includes(KW_CLUSTER)) KW_CLUSTER = KW_ALL;

  const inFacet = r => (KW_LOC === KW_ALL || r.location === KW_LOC)
                    && (KW_CLUSTER === KW_ALL || r.cluster === KW_CLUSTER);
  const scoped = (locs.length || clusters.length) ? tracked.filter(inFacet) : tracked;

  const JUMP = 3, GAIN = 1, TOP = 3, GOOD_POS = 10, HELD_POS = 30,
        MIN_VOL = 50, NEW_POS = 20, MAX_ROWS = 14, PAGE_SIZE = 15;
  const fell = r => has(r.movement) && r.movement < 0;
  const qualifies = r =>
       (has(r.movement) && r.movement >= GAIN)                       // gained ground, however small
    || (r.position <= TOP)                                           // top 3, any volume
    || (r.position <= GOOD_POS && (r.volume || 0) >= MIN_VOL)        // ranks well on a commercial term
    || (r.position <= HELD_POS && (r.volume || 0) >= MIN_VOL && !fell(r))  // holding a respectable spot
    || (r.is_new && r.position <= NEW_POS);                          // new win worth showing

  /* PER-CLIENT OPT-IN (DATA.rankings_sort, set in that client's data.json).
     'position' orders purely by best standing, so a keyword sitting at #1 leads the
     table instead of falling below a #30 that happened to jump. Meant to pair with
     rankings_show_all: "jumps lead" is right for a curated highlights list, but on a
     full list of every tracked term it reads as a broken sort. Absent or any other
     value keeps the original highlights-first ordering every other client renders. */
  const sortByPosition = !!(DATA && DATA.rankings_sort === 'position');

  const byStanding = (a, b) => {
    if (!sortByPosition) {
      const am = (has(a.movement) && a.movement >= JUMP) ? 1 : 0;
      const bm = (has(b.movement) && b.movement >= JUMP) ? 1 : 0;
      if (am !== bm) return bm - am;            // jumps lead
    }
    return a.position - b.position;             // then best positions
  };

  const ranked = scoped.filter(r => has(r.position) && r.position > 0);

  let rows, note;
  if (showAll) {
    /* Ranked terms first, best standing first, then everything holding no top-100
       position — biggest search volume first, so the most valuable gaps read first. */
    const unranked = scoped.filter(r => !(has(r.position) && r.position > 0))
                           .sort((a, b) => (b.volume || 0) - (a.volume || 0));
    rows = ranked.slice().sort(byStanding).concat(unranked);
    const scope = (KW_LOC === KW_ALL && KW_CLUSTER === KW_ALL)
      ? 'keywords we track for you'
      : `keywords in ${[KW_CLUSTER !== KW_ALL ? KW_CLUSTER : null,
                        KW_LOC !== KW_ALL ? KW_LOC : null].filter(Boolean).join(' · ')}`;
    note = `<strong>${rows.length}</strong> ${scope}. ` +
           `<strong>${ranked.length}</strong> currently hold a position in Google's top 100.`;
  } else {
    rows = ranked.filter(qualifies).sort(byStanding).slice(0, MAX_ROWS);
    const hidden = ranked.length - rows.length;
    note = hidden > 0 ? `Showing ${rows.length} of ${ranked.length} ranking keywords —
       top positions, biggest movers and new entries.` : '';
  }

  /* Volume drives WHICH keywords qualify above, but is deliberately not displayed —
     reported local search volumes badly understate reality (SE Ranking has
     "gladesville podiatrist" at 0/mo), so showing them undersells a #1 ranking. */
  const rowHTML = r => {
    const isRanked = has(r.position) && r.position > 0;
    const jumped   = isRanked && has(r.movement) && r.movement >= JUMP;
    let mv = '<span class="mv-flat">—</span>';
    if (isRanked) {
      if (r.is_new)                                  mv = '<span class="tag tag-new">new</span>';
      else if (has(r.movement) && r.movement > 0)    mv = `<span class="mv-up">↑ ${r.movement}</span>`;
      else if (has(r.movement) && r.movement < 0)    mv = `<span class="mv-down">↓ ${Math.abs(r.movement)}</span>`;
    }
    return `<tr class="${jumped ? 'row-jumped' : ''}">
      <td class="kw">${r.keyword}${
        KW_LOC === KW_ALL && r.location && multiLoc.has(r.keyword)
          ? ` <span class="tag tag-loc">${r.location}</span>` : ''
      }${jumped ? ' <span class="tag tag-good">big jump</span>' : ''}</td>
      <td class="r pos">${isRanked ? '#' + r.position : '<span class="kw-unranked">Not in top 100</span>'}</td>
      <td class="r">${mv}</td></tr>`;
  };

  /* Paging is client-side over data already on the page, so "show more" never
     refetches and the month toggle repaints from the top. */
  const chipRow = (label, values, current, kind) => values.length < 2 ? '' :
    `<div class="kw-facet"><span class="kw-facet-label">${label}</span>` +
    [KW_ALL].concat(values).map(v =>
      `<button type="button" class="${v === current ? 'active' : ''}"
         data-kind="${kind}" data-val="${v.replace(/"/g, '&quot;')}">${v}</button>`).join('') +
    '</div>';

  let shown = showAll ? Math.min(PAGE_SIZE, rows.length) : rows.length;
  const paint = () => {
    const left = rows.length - shown;
    kwEl.innerHTML =
      chipRow(LOC_LABEL, locs, KW_LOC, 'loc') +
      chipRow(CLU_LABEL, clusters, KW_CLUSTER, 'cluster') +
      (rows.length
        ? '<table class="tbl"><thead><tr><th>Keyword</th>' +
          '<th class="r">Position</th><th class="r">Movement</th></tr></thead><tbody>' +
          rows.slice(0, shown).map(rowHTML).join('') + '</tbody></table>' +
          (note ? `<div class="table-note">${note}</div>` : '') +
          (left > 0 ? `<div class="kw-more"><button type="button" id="kw-more-btn">` +
                      `Show ${Math.min(PAGE_SIZE, left)} more <span>(${left} to go)</span>` +
                      `</button></div>` : '')
        : '<div class="table-note">No keywords tracked for that combination.</div>');
    const btn = document.getElementById('kw-more-btn');
    if (btn) btn.addEventListener('click', () => { shown += PAGE_SIZE; paint(); });
    kwEl.querySelectorAll('.kw-facet button').forEach(b => {
      b.addEventListener('click', () => {
        if (b.dataset.kind === 'loc') KW_LOC = b.dataset.val;
        else                          KW_CLUSTER = b.dataset.val;
        renderSeo(m, prev);            // re-filter and reset paging to page one
      });
    });
  };
  paint();
}

/* ─── 4. GOOGLE MAPS (Google Business Profile) — a separate surface to the website.
   Search Console cannot see Maps at all, so nothing else on this dashboard covers it. ─── */
function renderMaps(m, prev) {
  const el   = document.getElementById('maps');
  const wrap = document.getElementById('maps-section');
  const g = m.maps, p = prev && prev.maps;

  /* Optional section. Hidden outright when the client has no Business Profile
     tracked — an empty panel reads as work we didn't do. */
  if (!g) { if (wrap) wrap.style.display = 'none'; el.innerHTML = ''; return; }
  if (wrap) wrap.style.display = '';

  /* VIEWS = Maps-surface + Search-surface impressions, shown as ONE number.
     data.json keeps them separate (the split matters in /seo-deep-dive, where the two
     surfaces routinely move in opposite directions) but the client dashboard must not
     show a second "Search impressions": the SEO strip above already has one from Search
     Console measuring the WEBSITE, an order of magnitude larger. Two same-named numbers
     that don't reconcile is how you lose trust in the whole page.
     Summed only when BOTH are present — a partial sum would understate views and read
     as a drop. */
  const views  = (has(g.impressions_maps) && has(g.impressions_search))
               ? g.impressions_maps + g.impressions_search : null;
  const pviews = (p && has(p.impressions_maps) && has(p.impressions_search))
               ? p.impressions_maps + p.impressions_search : null;

  let out = '<div class="kpi-row strip">' +
    kpiHTML('Views', has(views) ? num(views) : '—', delta(views, pviews, true)) +
    /* Interactions is stored, not summed on the fly, because a month can legitimately
       have one component missing and silently adding nulls would understate the total. */
    kpiHTML('Interactions', has(g.interactions) ? num(g.interactions) : '—',
            delta(g.interactions, p && p.interactions, true)) +
    kpiHTML('Phone calls', has(g.calls) ? num(g.calls) : '—',
            delta(g.calls, p && p.calls, true)) +
    kpiHTML('Website clicks', has(g.website_clicks) ? num(g.website_clicks) : '—',
            delta(g.website_clicks, p && p.website_clicks, true)) +
    /* Reviews: the headline is the running total, but the month's NEW reviews are what
       the clinic actually earned, so they lead the delta slot instead of a percentage.
       A percentage change on a total that only ever grows is noise. */
    kpiHTML('Reviews', has(g.reviews_total) ? num(g.reviews_total) : '—',
            has(g.reviews_new) && g.reviews_new > 0
              ? { cls:'delta-up', str:'+' + num(g.reviews_new) + ' this month' }
              : { cls:'delta-flat', str:'—' }) +
    '</div>';

  /* MAP-PACK COVERAGE, in plain English.
     Google Maps rank is geographic, not a single number: the profile is checked at a
     grid of points across the suburb and can be in the pack at one end and absent at
     the other. So we report the SHARE of the area, never a position.
     Same qualification rule as keyword rankings: a term earns its line by holding real
     coverage or by JUMPING, never by dropping. Nothing qualifying means no line at all,
     which is honest — not a 0% line that reads as a failure report. */
  const cov = (g.coverage || []).filter(c =>
    has(c.top3_points) && has(c.grid_points) && c.grid_points > 0);
  if (cov.length) {
    const pct   = c => c.top3_points / c.grid_points;
    const prevC = {};
    ((p && p.coverage) || []).forEach(c => {
      if (has(c.top3_points) && has(c.grid_points) && c.grid_points > 0) prevC[c.keyword] = pct(c);
    });
    const HOLD = 0.20, JUMP = 0.15;
    const rows = cov.filter(c => {
      const now  = pct(c);
      const was  = prevC[c.keyword];
      return now >= HOLD || (has(was) && now - was >= JUMP);
    }).sort((a, b) => pct(b) - pct(a));

    if (rows.length) {
      out += '<div class="notes"><ul>' + rows.map(c => {
        const now = Math.round(pct(c) * 100);
        const was = prevC[c.keyword];
        const move = has(was) ? ` (up from ${Math.round(was * 100)}%)` : '';
        return `<li>Showing in the top 3 on Google Maps across <strong>${now}%</strong>
                of your local area for &ldquo;${c.keyword}&rdquo;${move}</li>`;
      }).join('') + '</ul></div>';
    }
  }

  el.innerHTML = out;
}

/* ─── comment lists — items are strings, or {text, url} for links ─── */
/* variant 'done' swaps the gold star for a gold tick — completed work is
   shipped work, not a win, and marking it with a star oversells it. */
/* ─── booking funnel ─── */
/* Four places, three actions. Optional: a client with no `funnel` key never sees it.
   The channel choice is card-local state so switching month keeps the same channel. */
var FN_CHANNEL = 'all';

function renderFunnel(m) {
  const wrap = document.getElementById('funnel-section');
  const el   = document.getElementById('funnel');
  const f    = m.funnel;

  const note = document.getElementById('funnel-note');
  if (!f || !f.channels || !f.channels.length) {
    if (wrap) wrap.style.display = 'none';
    if (note) note.textContent = '';
    if (el) el.innerHTML = '';
    return;
  }
  if (wrap) wrap.style.display = '';

  const chans = f.channels;
  const byKey = k => chans.find(c => c.key === k);
  if (!byKey(FN_CHANNEL)) FN_CHANNEL = chans[0].key;

  const steps = c => [c.impressions, c.visits, c.booking_page, c.bookings];
  const system = f.booking_system || 'the booking system';

  const NAMES = ['Impressions', 'Website visits', system + ' booking page', 'Bookings'];
  const TIPS  = ['Times an ad or listing was shown',
                 'Sessions recorded in Google Analytics',
                 'Sessions that reached the ' + system + ' booking page',
                 'Confirmed ' + system + ' appointments, not enquiries or button clicks'];
  const BARS  = ['#B7AC97', '#17140E', '#8A6F3E', '#C29A50'];
  const ACTS  = ['clicked through to the website', 'opened the booking page', 'finished booking'];

  /* This funnel is the ONLINE booking path only. People who ring or fill in the contact
     form leave it at Website visits and never come back, so without this line the drop
     to the booking page reads as pure loss. */
  if (note) note.textContent = 'The online booking path only. Phone calls and contact form '
    + 'enquiries leave this funnel at Website visits. Both are counted in the Website section.';

  /* Bars use a log scale. 47,861 impressions and 9 bookings can't share a linear one —
     every step below the first renders as an invisible sliver. The log gives the taper;
     the percentage and the count beside it give the real size. */
  const width = (v, top) => (Math.log10(Math.max(v, 1)) / Math.log10(top)) * 100;
  const pctOf = (a, b) => (a / b) * 100;
  const pctTxt = n => n.toFixed(n < 10 ? 1 : 0) + '%';
  /* A channel with a zero or missing step can't carry a rate — bail rather than print NaN. */
  const usable = c => steps(c).every(v => has(v) && v > 0);

  const c = byKey(FN_CHANNEL);
  const v = steps(c);
  const top = v[0];

  let body = '';
  v.forEach((value, i) => {
    if (i > 0) {
      body += '<div class="fn-gap"><span class="fn-rule"></span>'
            + '<span class="fn-pct">' + (has(value) && v[i-1] ? pctTxt(pctOf(value, v[i-1])) : '—')
            + '<span>' + ACTS[i-1] + '</span></span></div>';
    }
    body += '<div class="fn-step">'
          + '<span class="fn-label" title="' + TIPS[i] + '">' + NAMES[i] + '</span>'
          + '<span class="fn-value">' + (has(value) ? num(value) : '—') + '</span>'
          + '<span class="fn-track"><span class="fn-fill" style="width:'
          + (has(value) ? width(value, top) : 0) + '%;background:' + BARS[i] + '"></span></span>'
          + '</div>';
  });

  /* Both lines below are computed from the numbers on the card, so neither can go
     stale and nobody has to hand-write a note each month. */
  let insight = '';
  if (usable(c)) {
    const early = pctOf(v[2], v[1]) <= pctOf(v[3], v[2]);
    insight = early
      ? '<b>The biggest drop is before they reach the booking page.</b> '
        + num(v[1] - v[2]) + ' of ' + num(v[1]) + ' visited the website and never opened ' + system + '.'
      : '<b>The biggest drop is inside the booking page.</b> '
        + num(v[2] - v[3]) + ' of ' + num(v[2]) + ' opened ' + system + " and didn't finish booking.";
  }

  /* A rate means nothing on its own, so the second line is always a comparison. */
  const endRate = x => (x.bookings / x.visits) * 100;
  const all = byKey('all');
  let compare = '';
  if (all && usable(all)) {
    const overall = endRate(all);
    if (FN_CHANNEL === 'all') {
      const others = chans.filter(x => x.key !== 'all' && usable(x))
                          .sort((a, b) => endRate(b) - endRate(a));
      if (others.length >= 2) {
        const best = others[0], worst = others[others.length - 1];
        compare = '<b>' + best.label + '</b> converts best: ' + endRate(best).toFixed(1)
                + '% of its visitors book. <b>' + worst.label + '</b> is lowest at '
                + endRate(worst).toFixed(1) + '%.';
      }
    } else if (usable(c)) {
      const r = endRate(c);
      const stance = r > overall * 1.15 ? 'ahead of'
                   : (r < overall * 0.85 ? 'behind' : 'in line with');
      compare = '<b>' + r.toFixed(1) + '%</b> of ' + c.label + ' visitors end up booking, '
              + stance + ' the <b>' + overall.toFixed(1) + '%</b> across all channels.';
    }
  }

  el.innerHTML =
      '<div class="fn-head"><span class="fn-ctx">' + c.label + '</span>'
    + '<div class="fn-toggle" role="group" aria-label="Channel">'
    + chans.map(x => '<button type="button" data-fn="' + x.key + '" aria-pressed="'
        + (x.key === FN_CHANNEL) + '">' + x.label + '</button>').join('')
    + '</div></div>'
    + '<div class="fn-steps">' + body + '</div>'
    + ((insight || compare)
        ? '<div class="fn-foot"><div class="fn-insight">' + insight + '</div>'
          + '<div class="fn-compare">' + compare + '</div></div>'
        : '');

  el.querySelectorAll('.fn-toggle button').forEach(b => {
    b.addEventListener('click', () => { FN_CHANNEL = b.dataset.fn; renderFunnel(m); });
  });
}

function renderList(elId, items, emptyMsg, variant) {
  const el = document.getElementById(elId);
  if (!items || !items.length) { el.innerHTML = emptyPanel(emptyMsg); return; }
  const li = i => {
    if (typeof i === 'string') return `<li>${i}</li>`;
    if (i.url) return `<li><a href="${i.url}" target="_blank" rel="noopener">${i.text}</a></li>`;
    return `<li>${i.text}${i.note ? ` <span class="na">(${i.note})</span>` : ''}</li>`;
  };
  el.innerHTML = `<div class="notes${variant === 'done' ? ' done' : ''}"><ul>`
               + items.map(li).join('') + '</ul></div>';
}

/* ─── month switch ─── */
function setMonth(key) {
  const idx  = DATA.months.findIndex(m => m.key === key);
  const m    = DATA.months[idx];
  const prev = idx > 0 ? DATA.months[idx - 1] : null;

  document.querySelectorAll('.toggle button').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('btn-' + key);
  if (btn) btn.classList.add('active');

  renderSummary(m);
  renderBusiness(m, prev);
  renderPaid(m, prev);
  renderServices(m, prev);
  renderSite(m, prev);
  renderSeo(m, prev);
  renderMaps(m, prev);
  renderFunnel(m);
  const hlWrap = document.getElementById('highlights-section');
  if (hlWrap) hlWrap.style.display = (m.highlights && m.highlights.length) ? '' : 'none';
  renderList('highlights', m.highlights, 'No highlights logged for this month.');
  renderList('completed',  m.completed,  'No completed work logged for this month.', 'done');
}

/* ─── bootstrap ─── */
async function init() {
  try {
    /* Published pages have the data inlined by scripts/build.py before encryption —
       fetching a separate data.json would leave the numbers readable next to an
       encrypted page. Falls back to fetch() for local preview of an unbuilt client. */
    if (window.__DASH_DATA__) {
      DATA = window.__DASH_DATA__;
    } else {
      const resp = await fetch('data.json');
      DATA = await resp.json();
    }

    document.getElementById('client-name').textContent = DATA.client;
    document.title = DATA.client + ' — Performance Dashboard';

    /* Scaffolded but not yet reported on. Show an honest holding state — an empty
       shell of zeroed panels would claim a month of nothing happened. */
    if (!DATA.months || !DATA.months.length) {
      document.getElementById('dash-body').style.display = 'none';
      const aw = document.getElementById('awaiting');
      aw.style.display = '';
      aw.innerHTML = '<div class="panel"><div class="empty">'
        + 'Your dashboard is set up and ready. Your figures appear here after your '
        + 'first monthly report.</div></div>';
      document.getElementById('foot').textContent = '';
      return;
    }

    /* SEO isn't on every client's plan. Hide the sections outright rather than
       leave empty panels that read as a gap in the work. */
    if (DATA.seo === false) {
      ['seo-section', 'rankings-section'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
    }

    /* newest month first (far left) — months[] stays chronological so deltas
       keep comparing against the preceding month */
    document.getElementById('month-toggle').innerHTML =
      DATA.months.slice().reverse()
        .map(m => `<button id="btn-${m.key}" onclick="setMonth('${m.key}')">${m.label}</button>`).join('');

    /* A missing updated_at made new Date(null) fall back to the epoch and the footer
       read "Updated 1 Jan 1970" on every client that never had one set. Drop the clause
       rather than print a date we don't have. */
    const d = DATA.updated_at ? new Date(DATA.updated_at) : null;
    /* Only name Business Profile as a source when a month actually carries Maps data,
       so a client without a tracked profile isn't told we used a source we didn't. */
    const hasMaps = DATA.months.some(m => m.maps);
    const sources = (DATA.seo === false
      ? 'Google Ads, Meta Ads & GA4'
      : 'Google Ads, Meta Ads, GA4, Search Console & SE Ranking')
      + (hasMaps ? ' & Google Business Profile' : '');
    const stamp = (d && !isNaN(d)) ? ' · Updated ' +
      d.toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' }) : '';
    document.getElementById('foot').textContent = sources + stamp;

    setMonth(DATA.months[DATA.months.length - 1].key);
  } catch (e) {
    document.getElementById('foot').textContent =
      'Could not load data.json. To preview locally: python3 -m http.server 8765';
    console.error(e);
  }
}
init();
