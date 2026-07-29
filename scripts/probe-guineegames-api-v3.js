#!/usr/bin/env node
// v3 : ajouter param date=YYYY-MM-DD

const BASE = 'https://sports-api.guineegames.com/v1';
const HEADERS = {
  accept: 'application/json',
  origin: 'https://www.guineegames.com',
  referer: 'https://www.guineegames.com/',
  'user-agent': 'Mozilla/5.0 Chrome/150.0.0.0',
  'accept-language': 'fr-FR,fr;q=0.9',
};

async function get(path, extra = {}) {
  const params = new URLSearchParams({
    country: 'GN', group: 'g6', platform: 'desktop', locale: 'fr',
    ...extra,
  }).toString();
  const url = `${BASE}${path}?${params}`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  const body = await res.text();
  console.log(`\n${path} → status=${res.status} size=${body.length}`);
  if (res.status !== 200) {
    console.log(`  err: ${body.slice(0, 250)}`);
    return null;
  }
  try { return JSON.parse(body); } catch { return null; }
}

// Aujourd'hui + demain + apres
const today = new Date();
const yyyy = today.getUTCFullYear();
const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
const dd = String(today.getUTCDate()).padStart(2, '0');
const dateToday = `${yyyy}-${mm}-${dd}`;
console.log(`Date probe: ${dateToday}`);

// Essai upcoming avec date
console.log('\n=== upcoming football today ===');
const up = await get('/events/upcoming', { sportId: 1, date: dateToday, limit: 20 });
if (up?.data) {
  const data = up.data;
  const cats = Array.isArray(data) ? [] : (data.categories || []);
  const events = [];
  if (Array.isArray(data)) events.push(...data);
  for (const c of cats) {
    for (const cp of (c.competitions || [])) {
      for (const ev of (cp.events || [])) {
        events.push({ ...ev, categoryName: c.name, competitionName: cp.name });
      }
    }
  }
  console.log(`  events found: ${events.length}`);
  if (events.length) {
    console.log(`\n  Sample 5 :`);
    for (const ev of events.slice(0, 5)) {
      console.log(`    id=${ev.id} ${ev.eventNames?.[0]} vs ${ev.eventNames?.[1]} | ${ev.categoryName || ''} - ${ev.competitionName || ''} | start=${ev.startTime || ev.startDate}`);
    }
    // Prendre un match avec un vrai championnat (pas amateur)
    const target = events.find((e) => /premier|liga|serie|bundes|ligue 1|championship|europa|champions/i.test(`${e.categoryName || ''} ${e.competitionName || ''}`)) || events[0];
    console.log(`\n═════════════════════════════════════════════════════════════════`);
    console.log(`═══ DUMP COTES : ${target.eventNames?.[0]} vs ${target.eventNames?.[1]}`);
    console.log(`═══ id=${target.id} | ${target.categoryName} - ${target.competitionName}`);
    console.log(`═══ start=${target.startTime || target.startDate}`);
    console.log(`═════════════════════════════════════════════════════════════════`);
    const details = await get(`/events/${target.id}`);
    if (details) {
      const d = details.data || details;
      const markets = [];
      if (Array.isArray(d.markets)) markets.push(...d.markets);
      if (Array.isArray(d.marketGroups)) for (const g of d.marketGroups) markets.push(...(g.markets || []));
      const seen = new Set();
      const uniqueMkts = markets.filter((m) => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
      console.log(`\n  TOTAL markets uniques : ${uniqueMkts.length}\n`);
      console.log(`  ═══ TOUS LES MARKETS ═══`);
      for (const m of uniqueMkts) {
        const line = m.baseValue ?? m.base ?? m.argument ?? m.line ?? m.handicap ?? m.specifier ?? '';
        const outs = (m.outcomes || []).map((o) => `${o.name}=${o.price || o.odds || o.value}`).join(' | ');
        console.log(`    ${m.name}${line !== '' ? ` [${line}]` : ''} : ${outs}`);
      }
    }
  }
}
