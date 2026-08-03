#!/usr/bin/env node
// Verifie que chaque book capte TOUS les matchs tennis (pas juste ATP/WTA)
// et PAS de tennis de table. Groupe par league, montre distribution, alerte
// si patterns suspects (TT Elite Series, Setka Cup, "table tennis", etc.)

import { bookmakersByKey } from '../src/bookmakers/index.js';

// Patterns qui indiquent du tennis de table (a EXCLURE)
const TT_PATTERNS = /table tennis|tt\s|setka|liga pro|tt cup|tt elite|tt eu|tt polska|challenger series tt|masters series tt|open series tt|world.*tt|international.*tt|czech.*liga|russia liga pro|ukraine.*win.*cup|belarus.*win|tt master|tt star|tt league|tt-cup/i;

// Patterns tennis "reculés" (ITF, Challenger, UTR, Futures)
const TENNIS_OBSCURE = /itf|challenger|utr|futures|w15|w25|w35|w50|w75|w100|m15|m25|m50|m75|m100/i;

const BOOKS = ['1xbet', '1win', 'congobet', 'apollo', 'betmomo', 'sportybet', 'premierbet', 'betpawa', 'yellowbet'];

console.log('▶▶▶ CHECK-UP COUVERTURE TENNIS PAR BOOK');

for (const bk of BOOKS) {
  const b = bookmakersByKey[bk];
  if (!b) continue;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${bk.toUpperCase()}`);
  let matches = [];
  try {
    matches = await b.listMatches({ live: false, horizonHours: 72, sport: 'tennis' });
  } catch (e) { console.log(`  ERR list: ${e.message}`); continue; }

  if (!matches.length) { console.log(`  0 matchs`); continue; }
  console.log(`  Total : ${matches.length} matchs`);

  // Groupe par league
  const byLeague = new Map();
  let ttSuspect = 0;
  let obscureCount = 0;
  let noLeague = 0;
  for (const m of matches) {
    const league = m.league || '(sans league)';
    if (!byLeague.has(league)) byLeague.set(league, []);
    byLeague.get(league).push(m);
    if (!m.league) noLeague++;
    const combined = `${league} ${m.home} ${m.away}`;
    if (TT_PATTERNS.test(combined)) ttSuspect++;
    if (TENNIS_OBSCURE.test(combined)) obscureCount++;
  }

  console.log(`  ${byLeague.size} leagues distinctes`);
  console.log(`  Sans league : ${noLeague}`);
  console.log(`  Suspects tennis de TABLE : ${ttSuspect}`);
  console.log(`  Categorie obscure (ITF/Challenger/UTR/Futures) : ${obscureCount}`);

  // Top 20 leagues par nb matchs
  const sorted = [...byLeague.entries()].sort((a, z) => z[1].length - a[1].length);
  console.log(`\n  Top 20 leagues :`);
  for (const [league, list] of sorted.slice(0, 20)) {
    const isTT = TT_PATTERNS.test(league) ? ' 🚨TT?' : '';
    const isObs = TENNIS_OBSCURE.test(league) ? ' [obscur]' : '';
    console.log(`    ${String(list.length).padStart(4)} × "${league}"${isTT}${isObs}`);
    // Sample : premier match
    const sample = list[0];
    console.log(`         → ex: "${sample.home}" vs "${sample.away}"`);
  }
  if (byLeague.size > 20) console.log(`    … +${byLeague.size - 20} autres leagues`);

  // Si suspects TT, lister
  if (ttSuspect > 0) {
    console.log(`\n  🚨 Sample suspects tennis de TABLE :`);
    let n = 0;
    for (const m of matches) {
      const combined = `${m.league} ${m.home} ${m.away}`;
      if (TT_PATTERNS.test(combined) && n < 5) {
        console.log(`      "${m.home}" vs "${m.away}" [${m.league}]`);
        n++;
      }
    }
  }
}

console.log('\n═══ FIN CHECK-UP ═══');
