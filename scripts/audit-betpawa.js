// Audit BetPawa via Cloudflare Worker.
import bp from '../src/bookmakers/betpawa/index.js';

console.log('=== BETPAWA AUDIT (via Cloudflare Worker user) ===\n');

const matches = await bp.listMatches({ live: false, sport: 'football' });
console.log(`Total matchs foot UPCOMING avec cotes : ${matches.length}`);

if (!matches.length) { process.exit(0); }

// Dump 5 samples
for (const [i, m] of matches.slice(0, 5).entries()) {
  const odds = await bp.getOdds(m);
  const keys = Object.keys(odds);
  console.log(`\n${i+1}. ${m.home} vs ${m.away} [id=${m.id}]`);
  console.log(`   ${keys.length} cotes : ${keys.map(k => `${k}=${odds[k]}`).join(' | ')}`);
}

process.exit(0);
