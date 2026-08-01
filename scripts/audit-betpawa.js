// Audit BetPawa : liste protobuf + fetch JSON /events/{id} par match.
import bp from '../src/bookmakers/betpawa/index.js';

console.log('=== BETPAWA AUDIT (list + JSON events) ===\n');

const matches = await bp.listMatches({ live: false, sport: 'football' });
console.log(`Total matchs foot UPCOMING : ${matches.length}`);

console.log('\n--- Sample 8 premiers matchs : fetch /events/{id} + parse ---');
let withOdds = 0;
for (const m of matches.slice(0, 8)) {
  const odds = await bp.getOdds(m);
  const keys = Object.keys(odds || {});
  if (keys.length) withOdds++;
  console.log(`  ${m.home} vs ${m.away} [id=${m.id}]`);
  console.log(`    keys=${keys.length} → ${keys.map((k) => `${k}=${odds[k]}`).join(' | ') || '(vide)'}`);
}
console.log(`\n  ${withOdds}/8 avec au moins 1 cote extraite`);

console.log('\n\n=== LIVE ===');
const live = await bp.listMatches({ live: true, sport: 'football' });
console.log(`Total matchs foot LIVE : ${live.length}`);
let liveWithOdds = 0;
for (const m of live.slice(0, 5)) {
  const odds = await bp.getOdds(m);
  const keys = Object.keys(odds || {});
  if (keys.length) liveWithOdds++;
  console.log(`  ${m.home} vs ${m.away} [id=${m.id}] keys=${keys.length}`);
}
console.log(`\n  ${liveWithOdds}/5 live avec cotes`);

process.exit(0);
