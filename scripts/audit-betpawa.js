// Debug BetPawa : dump la structure raw du Worker pour comprendre.
import { fetchViaWorker } from '../src/bookmakers/betpawa/api.js';
import bp from '../src/bookmakers/betpawa/index.js';

console.log('=== BETPAWA WORKER RAW DUMP ===\n');

const raw = await fetchViaWorker();
console.log(`Keys du top-level: ${Object.keys(raw || {}).join(', ')}`);
console.log(`success=${raw?.success} totalMatches=${raw?.totalMatches} matchesWithOdds=${raw?.matchesWithOdds}`);
console.log(`data.matches count: ${raw?.matches?.length ?? 'N/A'}\n`);

console.log('--- Sample first 3 raw match objects ---');
if (raw?.matches) {
  for (const [i, m] of raw.matches.slice(0, 5).entries()) {
    console.log(`\n[${i}]`, JSON.stringify(m, null, 2));
  }
}

console.log('\n\n--- Via bp.listMatches ---');
const matches = await bp.listMatches({ live: false, sport: 'football' });
console.log(`Total : ${matches.length}`);
const withOdds = [];
for (const m of matches) {
  const odds = await bp.getOdds(m);
  if (Object.keys(odds).length > 0) withOdds.push({ home: m.home, away: m.away, odds });
}
console.log(`With odds : ${withOdds.length}`);
for (const w of withOdds.slice(0, 5)) {
  console.log(`  ${w.home} vs ${w.away} : ${Object.entries(w.odds).map(([k, v]) => `${k}=${v}`).join(' | ')}`);
}

process.exit(0);
