#!/usr/bin/env node
// Probe premierbet v2 : dump structures brutes de chaque marche

import { pbGet, extractMarkets } from '../src/bookmakers/premierbet/api.js';
import { listMatches } from '../src/bookmakers/premierbet/list.js';
import { premierbetFlatOdds } from '../src/bookmakers/premierbet/parse.js';

const matches = await listMatches({ live: false, horizonHours: 72 });
const m = matches[0];
if (!m) process.exit(0);
console.log(`Match: ${m.home} vs ${m.away} (id=${m.id})\n`);

const data = await pbGet(`/events/${m.id}`, {}, { long: false });
const event = data?.data || data || null;
const markets = extractMarkets(event);
console.log(`${markets.length} marches extraits\n`);

for (const mk of markets) {
  const name = mk.name || mk.title || '?';
  const line = mk.baseValue ?? mk.base ?? mk.argument ?? mk.line ?? null;
  const oc = (mk.outcomes || []).map(o => `${o.name}=${o.value ?? o.odds ?? o.price}`).join(' | ');
  console.log(`  "${name}" [line=${line}] → ${oc}`);
}

console.log(`\n=== flat odds parsed ===`);
const flat = premierbetFlatOdds(markets);
console.log(`${Object.keys(flat).length} cotes plates`);
console.log(`cles: ${Object.keys(flat).sort().join(', ')}`);
