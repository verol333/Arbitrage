#!/usr/bin/env node
// v2 : corriger les params (sportId en query, pas path) et fetch match foot + cotes

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
  console.log(`\n${path}?${Object.entries(extra).slice(0, 3).map(([k, v]) => `${k}=${v}`).join('&')}\n  status=${res.status} size=${body.length}`);
  if (res.status !== 200) {
    console.log(`  err: ${body.slice(0, 200)}`);
    return null;
  }
  try { return JSON.parse(body); } catch { return null; }
}

// 1. upcoming football (sportId=1)
console.log('=== upcoming football (sportId=1) ===');
const up = await get('/events/upcoming', { sportId: 1, limit: 20 });
if (up?.data) {
  const cats = up.data.categories || [];
  console.log(`  categories=${cats.length}`);
  const events = [];
  for (const c of cats) {
    for (const cp of (c.competitions || [])) {
      for (const ev of (cp.events || [])) {
        events.push({ ...ev, categoryName: c.name, competitionName: cp.name });
      }
    }
  }
  console.log(`  total events football: ${events.length}`);
  console.log(`\n  Premiers 5 matchs foot :`);
  for (const ev of events.slice(0, 5)) {
    console.log(`    id=${ev.id} ${ev.eventNames?.[0]} vs ${ev.eventNames?.[1]} | ${ev.categoryName} - ${ev.competitionName} | start=${ev.startTime || ev.startDate}`);
  }
  // Choisir 1 match pour dump complet
  const target = events[0];
  if (target) {
    console.log(`\n═════════════════════════════════════════════════════════════════`);
    console.log(`═══ DUMP COMPLET COTES : ${target.eventNames?.[0]} vs ${target.eventNames?.[1]} ═══`);
    console.log(`   id=${target.id} | ${target.categoryName} - ${target.competitionName}`);
    console.log(`   start=${target.startTime || target.startDate}`);
    console.log(`═════════════════════════════════════════════════════════════════`);
    const details = await get(`/events/${target.id}`);
    if (details) {
      const d = details.data || details;
      const markets = [];
      if (Array.isArray(d.markets)) markets.push(...d.markets);
      if (Array.isArray(d.marketGroups)) for (const g of d.marketGroups) markets.push(...(g.markets || []));
      const seen = new Set();
      const uniqueMkts = markets.filter((m) => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
      console.log(`\n  TOTAL markets UNIQUES : ${uniqueMkts.length}`);
      console.log(`\n  ═══ TOUS LES MARKETS AVEC COTES ═══`);
      for (const m of uniqueMkts) {
        const line = m.baseValue ?? m.base ?? m.argument ?? m.line ?? m.handicap ?? m.specifier ?? '';
        const outs = (m.outcomes || []).map((o) => `${o.name}=${o.price || o.odds || o.value}`).join(' | ');
        console.log(`    ${m.name}${line !== '' ? ` (${line})` : ''} : ${outs}`);
      }
    }
  }
}
