#!/usr/bin/env node
// Dictionnaire complet PremierBet tennis via guineegames (sportId=5)
// Objectif : lister TOUS les marketIds + noms sur 5 matchs pour capturer max variantes
import { fetchJson } from '../src/net/fetcher.js';

const HDR = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://www.guineegames.com/',
};
const params = 'country=GN&group=g6&platform=desktop&locale=fr';
const date = new Date().toISOString().slice(0, 10);

// Liste events tennis
const listUrl = `https://sports-api.guineegames.com/v1/events/upcoming?${params}&sportId=5&timeOffset=-60&date=${date}`;
const list = await fetchJson(listUrl, { headers: HDR, timeoutMs: 20000 });
const events = [];
for (const c of (list?.data?.categories || [])) {
  for (const comp of (c.competitions || c.tournaments || [])) {
    for (const e of (comp.events || [])) events.push({ ...e, catName: c.name, compName: comp.name });
  }
}
console.log(`${events.length} events tennis dispos\n`);

// Prendre 5 matchs qui ont un marketCount > 5 (ATP/WTA riches)
const sample = events.filter(e => (e.marketCount || 0) > 5).slice(0, 5);
console.log(`${sample.length} matchs avec >5 markets :\n`);
for (const e of sample) {
  const names = e.competitors?.map(x => x.name) || e.eventNames || [];
  console.log(`  - ${names[0]} vs ${names[1]} [${e.catName} / ${e.compName}] (marketCount=${e.marketCount})`);
}

// Pour chaque match, fetch full markets et stats par marketId
const marketStats = {}; // id → { descs, count, handicaps, outcomes samples }

for (const ev of sample) {
  const evtUrl = `https://sports-api.guineegames.com/v1/events/${ev.id}?${params}`;
  const evt = await fetchJson(evtUrl, { headers: HDR, timeoutMs: 15000 });
  const event = evt?.data || evt;
  const marketGroups = event?.marketGroups || [];
  const names = ev.competitors?.map(x => x.name) || ev.eventNames || [];
  const matchLabel = `${names[0]} vs ${names[1]}`;

  // On collecte tous les marchés en dédupliquant par (id) pour éviter doublons groupes
  const seenInMatch = new Set();
  for (const g of marketGroups) {
    for (const mk of (g.markets || [])) {
      const key = String(mk.id || '');
      if (seenInMatch.has(key)) continue; // dedup par match
      seenInMatch.add(key);
      if (!marketStats[key]) marketStats[key] = { descs: new Set(), count: 0, handicaps: new Set(), samples: [], groups: new Set() };
      marketStats[key].descs.add(mk.name || '?');
      marketStats[key].groups.add(g.name);
      marketStats[key].count++;
      for (const o of (mk.outcomes || [])) {
        if (o.handicap != null) marketStats[key].handicaps.add(o.handicap);
      }
      if (marketStats[key].samples.length < 3) {
        const outs = (mk.outcomes || []).slice(0, 6).map(o => `"${o.name}"h=${o.handicap ?? ''}=${o.value}`);
        marketStats[key].samples.push({ matchLabel, outcomes: outs });
      }
    }
  }
}

console.log(`\n═══ DICTIONNAIRE : ${Object.keys(marketStats).length} marketIds distincts ═══\n`);
for (const id of Object.keys(marketStats).sort((a, b) => Number(a) - Number(b))) {
  const s = marketStats[id];
  console.log(`\n━━ id=${id} ━━`);
  console.log(`  Description(s) : ${[...s.descs].join(' | ')}`);
  console.log(`  Group(s) : ${[...s.groups].join(', ')}`);
  console.log(`  Instances : ${s.count} matchs`);
  if (s.handicaps.size > 0) console.log(`  Handicaps distincts : ${[...s.handicaps].sort((a, b) => Number(a) - Number(b)).join(', ')}`);
  console.log(`  Exemples :`);
  for (const sm of s.samples) {
    console.log(`    [${sm.matchLabel}]`);
    console.log(`      ${sm.outcomes.join(' | ')}`);
  }
}
