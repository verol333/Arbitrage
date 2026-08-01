// Probe BetPawa : liste 3 events UPCOMING et dump TOUS les marketType.id + name
// + 3 premiers outcomes. Sert à identifier les IDs qu'il faut mapper dans parse.js.
import { listMatches } from '../src/bookmakers/betpawa/list.js';
import { bpFetchEvent } from '../src/bookmakers/betpawa/api.js';

console.log('=== PROBE BETPAWA MARKETS ===\n');
const matches = await listMatches({ live: false });
console.log(`Total upcoming: ${matches.length}\n`);

const marketMap = new Map();
for (const m of matches.slice(0, 3)) {
  console.log(`─── ${m.home} vs ${m.away} [id=${m.id}] ───`);
  const evt = await bpFetchEvent(m.id);
  if (!evt) { console.log('  no event data'); continue; }
  const markets = evt?.markets || [];
  console.log(`  ${markets.length} markets`);
  for (const mkt of markets) {
    const mid = String(mkt?.marketType?.id || '?');
    const mname = mkt?.marketType?.name || '?';
    const key = `${mid}: ${mname}`;
    const prices = [];
    for (const row of (mkt.row || [])) {
      for (const p of (row.prices || []).slice(0, 4)) prices.push(`${p.name || p.displayName || '?'}@${p.odds}`);
    }
    console.log(`    [${mid}] "${mname}" (${prices.length} prices): ${prices.slice(0, 6).join(' | ')}`);
    if (!marketMap.has(key)) marketMap.set(key, 0);
    marketMap.set(key, marketMap.get(key) + 1);
  }
  console.log();
}
console.log('\n=== SYNTHÈSE market IDs vus (fréquence sur 3 events) ===');
for (const [k, n] of [...marketMap.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ×${n}  ${k}`);
process.exit(0);
