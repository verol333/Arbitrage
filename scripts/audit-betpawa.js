// Audit BetPawa : appel direct + extraction floats protobuf.
import bp from '../src/bookmakers/betpawa/index.js';

console.log('=== BETPAWA AUDIT (direct call + float extraction) ===\n');

const matches = await bp.listMatches({ live: false, sport: 'football' });
console.log(`\nTotal matchs foot UPCOMING : ${matches.length}`);
const withOdds = matches.filter(m => m.__raw?.odds?.length === 3);
console.log(`Avec cotes 1X2 extraites : ${withOdds.length}`);

console.log('\n--- Sample 8 first matches with odds ---');
for (const m of withOdds.slice(0, 8)) {
  const odds = await bp.getOdds(m);
  console.log(`  ${m.home} vs ${m.away} [id=${m.id}]`);
  console.log(`    ${Object.entries(odds).map(([k, v]) => `${k}=${v}`).join(' | ')}`);
}

// Live check
console.log('\n\n=== LIVE ===');
const live = await bp.listMatches({ live: true, sport: 'football' });
console.log(`Total matchs foot LIVE : ${live.length}`);
const liveWithOdds = live.filter(m => m.__raw?.odds?.length === 3);
console.log(`Avec cotes : ${liveWithOdds.length}`);

process.exit(0);
