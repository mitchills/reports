/* Mastered Marketing — client performance dashboard
   Monthly historical view. One data.json per client.
   Rule: a missing number renders as "no data", NEVER as zero. */

let DATA = null;

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

function kpiHTML(label, value, d) {
  return `<div class="kpi">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value">${value}</div>
    <div class="kpi-delta ${d.cls}">${d.str}</div>
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
  const card = (label, key, fmt, better, extra) => {
    const val = t && t[key];
    const d   = delta(val, pt && pt[key], better);
    const split = [
      { name:'Google', v: g  && g[key] },
      { name:'Meta',   v: mt && mt[key] }
    ].filter(s => has(s.v));
    return `<div class="card">
      <div class="card-label">${label}</div>
      <div class="card-value">${has(val) ? fmt(val) : '<span class="na">no data</span>'}</div>
      <div class="card-delta ${d.cls}">${d.str}${extra || ''}</div>
      <div class="split">${split.map(s =>
        `<span class="split-pill"><b>${fmt(s.v)}</b> ${s.name}</span>`).join('')}</div>
    </div>`;
  };

  let targetTag = '';
  if (t && has(t.cpa) && has(DATA.target_cpa)) {
    const under = t.cpa <= DATA.target_cpa;
    targetTag = ` <span class="tag ${under ? 'tag-good' : 'tag-bad'}">${under ? 'under' : 'over'} $${DATA.target_cpa} target</span>`;
  }

  el.innerHTML = '<div class="card-row">' +
    card('Conversions',         'conversions', num,  true)  +
    card('Cost per conversion', 'cpa',         aud2, false, targetTag) +
    card('Spend',               'spend',       aud,  null)  +
    '</div>';
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
    '</div>';

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
    el.innerHTML = '<div class="kpi-row strip">' +
      kpiHTML('Organic sessions', (o && has(o.sessions)) ? num(o.sessions) : '—',
              delta(o && o.sessions, po && po.sessions, true)) +
      kpiHTML('Search impressions', (s && has(s.impressions)) ? num(s.impressions) : '—',
              delta(s && s.impressions, ps && ps.impressions, true)) +
      /* lower position number = better, so this delta is inverted */
      kpiHTML('Avg. position', (s && has(s.avg_position)) ? s.avg_position.toFixed(1) : '—',
              delta(s && s.avg_position, ps && ps.avg_position, false)) +
      (has(kw) ? kpiHTML('Keywords ranking',
              num(kw) + ((s && has(s.keywords_top10)) ? ` <span class="of">${num(s.keywords_top10)} in top 10</span>` : ''),
              delta(kw, pkw, true)) : '') +
      kpiHTML('Pages ranking', (s && has(s.ranked_pages)) ? num(s.ranked_pages) : '—',
              delta(s && s.ranked_pages, ps && ps.ranked_pages, true)) +
      '</div>';
  }

  /* Which keywords make the cut. A keyword earns its place by RANKING WELL,
     JUMPING, or being a NEW WIN — never by dropping. Drops are still shown
     honestly on keywords that qualified some other way, we just never
     surface a keyword because it fell. */
  const kwEl = document.getElementById('rankings');
  const all = (m.rankings || []).filter(r => has(r.position) && r.position > 0);
  if (!all.length) {
    kwEl.innerHTML = emptyPanel('No keyword ranking data recorded for this month.');
    return;
  }

  const JUMP = 3, TOP = 3, GOOD_POS = 10, MIN_VOL = 50, NEW_POS = 20, MAX_ROWS = 14;
  const qualifies = r =>
       (has(r.movement) && r.movement >= JUMP)                       // jumped
    || (r.position <= TOP)                                           // top 3, any volume
    || (r.position <= GOOD_POS && (r.volume || 0) >= MIN_VOL)        // ranks well on a commercial term
    || (r.is_new && r.position <= NEW_POS);                          // new win worth showing

  const rows = all.filter(qualifies).sort((a, b) => {
    const am = (has(a.movement) && a.movement >= JUMP) ? 1 : 0;
    const bm = (has(b.movement) && b.movement >= JUMP) ? 1 : 0;
    if (am !== bm) return bm - am;              // jumps lead
    return a.position - b.position;             // then best positions
  }).slice(0, MAX_ROWS);

  const hidden = all.length - rows.length;

  /* Volume drives WHICH keywords qualify above, but is deliberately not displayed —
     reported local search volumes badly understate reality (SE Ranking has
     "gladesville podiatrist" at 0/mo), so showing them undersells a #1 ranking. */
  kwEl.innerHTML = '<table class="tbl"><thead><tr><th>Keyword</th>' +
    '<th class="r">Position</th><th class="r">Movement</th></tr></thead><tbody>' +
    rows.map(r => {
      const jumped = has(r.movement) && r.movement >= JUMP;
      let mv = '<span class="mv-flat">—</span>';
      if (r.is_new)                                    mv = '<span class="tag tag-new">new</span>';
      else if (has(r.movement) && r.movement > 0)      mv = `<span class="mv-up">↑ ${r.movement}</span>`;
      else if (has(r.movement) && r.movement < 0)      mv = `<span class="mv-down">↓ ${Math.abs(r.movement)}</span>`;
      return `<tr class="${jumped ? 'row-jumped' : ''}">
        <td class="kw">${r.keyword}${jumped ? ' <span class="tag tag-good">big jump</span>' : ''}</td>
        <td class="r pos">#${r.position}</td>
        <td class="r">${mv}</td></tr>`;
    }).join('') + '</tbody></table>' +
    (hidden > 0 ? `<div class="table-note">Showing ${rows.length} of ${all.length} ranking keywords —
       top positions, biggest movers and new entries.</div>` : '');
}

/* ─── comment lists — items are strings, or {text, url} for links ─── */
function renderList(elId, items, emptyMsg) {
  const el = document.getElementById(elId);
  if (!items || !items.length) { el.innerHTML = emptyPanel(emptyMsg); return; }
  const li = i => {
    if (typeof i === 'string') return `<li>${i}</li>`;
    if (i.url) return `<li><a href="${i.url}" target="_blank" rel="noopener">${i.text}</a></li>`;
    return `<li>${i.text}${i.note ? ` <span class="na">(${i.note})</span>` : ''}</li>`;
  };
  el.innerHTML = '<div class="notes"><ul>' + items.map(li).join('') + '</ul></div>';
}

/* ─── month switch ─── */
function setMonth(key) {
  const idx  = DATA.months.findIndex(m => m.key === key);
  const m    = DATA.months[idx];
  const prev = idx > 0 ? DATA.months[idx - 1] : null;

  document.querySelectorAll('.toggle button').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('btn-' + key);
  if (btn) btn.classList.add('active');

  document.getElementById('period-meta').textContent =
    m.label + (prev ? ' · compared with ' + prev.label : ' · no prior month on record');

  renderSummary(m);
  renderBusiness(m, prev);
  renderPaid(m, prev);
  renderSite(m, prev);
  renderSeo(m, prev);
  const hlWrap = document.getElementById('highlights-section');
  if (hlWrap) hlWrap.style.display = (m.highlights && m.highlights.length) ? '' : 'none';
  renderList('highlights', m.highlights, 'No highlights logged for this month.');
  renderList('completed',  m.completed,  'No completed work logged for this month.');
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

    /* newest month first (far left) — months[] stays chronological so deltas
       keep comparing against the preceding month */
    document.getElementById('month-toggle').innerHTML =
      DATA.months.slice().reverse()
        .map(m => `<button id="btn-${m.key}" onclick="setMonth('${m.key}')">${m.label}</button>`).join('');

    const d = new Date(DATA.updated_at);
    document.getElementById('foot').textContent =
      'Google Ads, Meta Ads, GA4, Search Console & SE Ranking · Updated ' +
      d.toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' });

    setMonth(DATA.months[DATA.months.length - 1].key);
  } catch (e) {
    document.getElementById('foot').textContent =
      'Could not load data.json. To preview locally: python3 -m http.server 8765';
    console.error(e);
  }
}
init();
