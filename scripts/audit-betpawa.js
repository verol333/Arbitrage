// Audit BetPawa foot : liste tous les matchs, dump 2 samples avec cotes.
import bp from '../src/bookmakers/betpawa/index.js';
import { bpGetStrings, buildEventsUrl } from '../src/bookmakers/betpawa/api.js';

console.log('=== BETPAWA AUDIT ===\n');

const matches = await bp.listMatches({ live: false, sport: 'football', horizonHours: 168 });
console.log(`Total matchs foot UPCOMING : ${matches.length}`);

if (matches.length === 0) {
  console.log('AUCUN match — dump raw strings pour debug :');
  const strings = await bpGetStrings(buildEventsUrl({ eventType: 'UPCOMING', skip: 0, take: 20 }));
  console.log(`Raw strings count: ${strings.length}`);
  for (const s of strings.slice(0, 100)) console.log(`  "${s}"`);
  process.exit(0);
}

// Pick 3 samples
const picks = [matches[0], matches[Math.floor(matches.length / 2)], matches[matches.length - 1]].filter(Boolean);
for (const [i, m] of picks.entries()) {
  console.log(`\n─── MATCH ${i + 1}/${picks.length} : ${m.home} vs ${m.away} [id=${m.id}] ───`);
  const odds = await bp.getOdds(m);
  const keys = Object.keys(odds);
  console.log(`  Cotes parsées : ${keys.length}`);
  for (const k of keys.sort()) console.log(`    ${k} = ${odds[k]}`);

  // Aussi dump les ~50 strings autour du match pour comprendre structure
  if (i === 0) {
    console.log('\n  Raw strings around match (debug) :');
    const start = m.__raw.matchIndex;
    for (let j = start; j < Math.min(start + 60, m.__raw.strings.length); j++) {
      console.log(`    [${j}] "${m.__raw.strings[j]}"`);
    }
  }
}

// Live check
console.log('\n\n=== LIVE ===');
const live = await bp.listMatches({ live: true, sport: 'football' });
console.log(`Total matchs foot LIVE : ${live.length}`);
if (live.length > 0) {
  const m = live[0];
  console.log(`  Sample : ${m.home} vs ${m.away}`);
  const odds = await bp.getOdds(m);
  console.log(`  Cotes : ${Object.keys(odds).length} — ${Object.entries(odds).slice(0, 5).map(([k, v]) => `${k}=${v}`).join(', ')}`);
}

process.exit(0);
