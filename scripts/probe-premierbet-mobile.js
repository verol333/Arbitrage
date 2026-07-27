#!/usr/bin/env node
// Probe autonome de l'API mobile PremierBet Congo — reproduit fidelement
// le script Python de reference (premierbet_full_scrape.py) en JavaScript.
// Aucune dependance : utilise fetch natif Node 18+.
//
// Usage :
//   node scripts/probe-premierbet-mobile.js
//
// Log structure sans donnee sensible : URL, methode, params, status, taille,
// duree, cles JSON. Permet de comparer environnement local vs prod GH Actions
// pour identifier ce qui differe (IP source, DNS, headers, route).

const BASE = 'https://sports-api.premierbet.com/cg/v1';
const COMMON_PARAMS = {
  country: 'CG',
  group: 'g5',
  platform: 'mobile',
  locale: 'fr',
};
const HEADERS = { accept: 'application/json' };
const SPORT_ID_FOOT = '1';

// Congo-Brazzaville = UTC+1 fixe.
const TZ = 60 * 60 * 1000;
const now = Date.now();
const today = new Date(now + TZ).toISOString().slice(0, 10);

function qs(extra = {}) {
  return new URLSearchParams({ ...COMMON_PARAMS, ...extra }).toString();
}

async function probe(path, extra = {}) {
  const params = qs(extra);
  const url = `${BASE}${path}?${params}`;
  const t0 = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  let status = 0, body = '', err = null;
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    status = res.status;
    body = await res.text();
  } catch (e) {
    err = e.message || String(e);
  } finally { clearTimeout(t); }
  const dur = Date.now() - t0;
  const size = body.length;
  let jsonKeys = null, dataShape = null, eventCount = null;
  if (status === 200) {
    try {
      const j = JSON.parse(body);
      jsonKeys = Object.keys(j);
      if (Array.isArray(j.data)) {
        dataShape = 'array';
        eventCount = j.data.length;
      } else if (j.data && typeof j.data === 'object') {
        dataShape = 'object';
        const cats = j.data.categories || [];
        eventCount = cats.reduce((n, c) => n + (c.competitions || []).reduce((m, k) => m + (k.events || []).length, 0), 0);
      }
    } catch { /* non-JSON body */ }
  }
  const summary = [
    `GET ${path}?${params}`,
    `status=${status || 'ERR'}`,
    `size=${size}b`,
    `dur=${dur}ms`,
    jsonKeys ? `keys=[${jsonKeys.slice(0, 5).join(',')}]` : null,
    dataShape ? `data.shape=${dataShape}` : null,
    eventCount != null ? `events=${eventCount}` : null,
    err ? `err="${err}"` : null,
    status && status !== 200 ? `snippet="${body.slice(0, 100).replace(/\s+/g, ' ')}"` : null,
  ].filter(Boolean).join(' ');
  console.log(summary);
  return { status, body, dur, jsonKeys, dataShape, eventCount };
}

(async () => {
  console.log(`=== Probe PremierBet mobile API (${new Date().toISOString()}) ===`);
  console.log(`BASE=${BASE}`);
  console.log(`HEADERS=${JSON.stringify(HEADERS)}`);
  console.log(`today=${today}\n`);

  console.log('--- 1) Listings (les 3 sources du script Python) ---');
  const up = await probe('/events/upcoming', { timeOffset: '-60', sportId: SPORT_ID_FOOT, date: today });
  const live = await probe('/events/live', { sportId: SPORT_ID_FOOT, zoomSportId: '61' });
  const hl = await probe('/events/highlights', { sportId: SPORT_ID_FOOT });

  // Extraction d'un event id pour tester /events/{id}
  let firstId = null;
  try {
    const j = JSON.parse(up.body);
    for (const c of (j?.data?.categories || [])) {
      for (const k of (c.competitions || [])) {
        if (k.events?.length) { firstId = k.events[0].id; break; }
      }
      if (firstId) break;
    }
  } catch { /* upcoming KO */ }

  if (firstId) {
    console.log(`\n--- 2) Detail d'un event (id=${firstId}) ---`);
    const detail = await probe(`/events/${firstId}`);
    if (detail.status === 200) {
      try {
        const ev = JSON.parse(detail.body);
        const markets = (ev.markets || []).length
          || (ev.marketGroups || []).reduce((n, g) => n + (g.markets || []).length, 0);
        console.log(`  → event.state=${ev.state} startTime=${ev.startTime} eventNames=${JSON.stringify(ev.eventNames)} markets=${markets}`);
      } catch { /* non-JSON */ }
    }
  } else {
    console.log('\n--- 2) Detail SKIP (pas d\'event id extrait) ---');
  }

  console.log('\n--- RESUME ---');
  const oks = [up, live, hl].filter((r) => r.status === 200).length;
  console.log(`Endpoints OK : ${oks}/3`);
  console.log(`Attendu local : 3/3 avec status=200 et events > 0 sur upcoming.`);
  console.log(`Observed prod (GH Actions runner Azure): 0/3 avec status=403 body="Sorry, you have been blocked".`);
  console.log(`Ecart : la seule difference est l'IP source du client. L'API mobile filtre au niveau CF.`);
})();
