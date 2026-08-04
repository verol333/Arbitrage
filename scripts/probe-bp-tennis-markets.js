#!/usr/bin/env node
// Dump BRUT des marchés tennis BetPawa : identifier les marketType.id tennis
// (Winner, Games Handicap, Total Games, Set Winner, etc.) pour ecrire parseur.
import { listMatches } from '../src/bookmakers/betpawa/list.js';
import { bpFetchEvent } from '../src/bookmakers/betpawa/api.js';

console.log('▶▶▶ Dump marches tennis BetPawa (raw markets)');

const matches = await listMatches({ live: false, horizonHours: 72, sport: 'tennis' });
console.log(`${matches.length} matchs tennis`);
if (!matches.length) process.exit(0);

// Prendre 2 matchs
const sample = matches.slice(0, 2);
for (const m of sample) {
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`MATCH ${m.id} : "${m.home}" vs "${m.away}"`);
  const ev = await bpFetchEvent(m.id, 20_000, { fresh: true });
  if (!ev) { console.log('  (aucun event JSON)'); continue; }
  const markets = ev.markets || [];
  console.log(`  ${markets.length} marches\n`);
  // Groupe par marketType.id
  const byId = new Map();
  for (const mkt of markets) {
    const id = mkt?.marketType?.id;
    const name = mkt?.marketType?.name || '';
    if (!byId.has(id)) byId.set(id, { name, samples: [] });
    // Aplatir prices + garder les infos ROW (handicap, name, etc)
    for (const row of (mkt.row || [])) {
      for (const p of (row.prices || [])) {
        byId.get(id).samples.push({
          name: p.name, displayName: p.displayName, odds: p.odds,
          row_all: JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'prices'))),
        });
      }
    }
  }
  const sortedIds = [...byId.entries()].sort((a, z) => (a[1].name || '').localeCompare(z[1].name || ''));
  for (const [id, info] of sortedIds) {
    console.log(`  ── marketId=${id} "${info.name}" (${info.samples.length} outcomes)`);
    for (const s of info.samples.slice(0, 8)) {
      const parts = [];
      if (s.name) parts.push(`name="${s.name}"`);
      if (s.displayName && s.displayName !== s.name) parts.push(`disp="${s.displayName}"`);
      parts.push(`odds=${s.odds}`);
      parts.push(`row=${s.row_all}`);
      console.log(`      ${parts.join(' | ')}`);
    }
    if (info.samples.length > 8) console.log(`      … +${info.samples.length - 8} outcomes`);
  }
}

console.log('\n═══ FIN ═══');
