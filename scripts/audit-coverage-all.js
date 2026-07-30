#!/usr/bin/env node
// Audit complet : combien de matchs + marchés par book x sport
// Objectif : verifier qu'on recupere le max possible (post fixes)

import { bookmakers } from '../src/bookmakers/index.js';

const SPORTS = ['football', 'tennis', 'basketball'];
const HORIZON = 72;

console.log(`Audit couverture : ${bookmakers.length} books x ${SPORTS.length} sports\n`);

const summary = {};

for (const sport of SPORTS) {
  console.log(`\n════════ ${sport.toUpperCase()} ════════`);
  summary[sport] = {};

  for (const book of bookmakers) {
    if (!book.supports.prematch) { console.log(`  ${book.key}: (prematch non supporte)`); continue; }
    const t0 = Date.now();
    let matches = [];
    try {
      matches = await book.listMatches({ live: false, horizonHours: HORIZON, sport });
    } catch (e) {
      console.log(`  ${book.key}: ERR listMatches ${e.message}`);
      summary[sport][book.key] = { matches: 0, err: e.message };
      continue;
    }
    const ms = Date.now() - t0;
    console.log(`  ${book.key.padEnd(12)} ${matches.length.toString().padStart(4)} matchs (${ms}ms)`);
    summary[sport][book.key] = { matches: matches.length, ms };

    // Echantillon 10 matchs (evite biais des openers minimalistes) + max/min
    if (matches.length > 0 && book.getOdds) {
      const perMatch = [];
      const sample = matches.slice(0, Math.min(10, matches.length));
      for (const m of sample) {
        try {
          const odds = await book.getOdds(m, { sport, live: false });
          perMatch.push(Object.keys(odds || {}).length);
        } catch { perMatch.push(0); }
      }
      const avg = perMatch.length > 0 ? Math.round(perMatch.reduce((a, b) => a + b, 0) / perMatch.length) : 0;
      const max = Math.max(...perMatch, 0);
      const min = Math.min(...perMatch);
      summary[sport][book.key].avgMarkets = avg;
      summary[sport][book.key].maxMarkets = max;
      console.log(`     ↳ marches/match : avg=${avg} min=${min} max=${max} (echantillon ${perMatch.length}/10) — dist=[${perMatch.join(',')}]`);
    }
  }
}

console.log('\n\n═══ SUMMARY ═══');
for (const sport of SPORTS) {
  console.log(`\n${sport}:`);
  for (const [book, s] of Object.entries(summary[sport])) {
    console.log(`  ${book.padEnd(12)} ${(s.matches || 0).toString().padStart(4)} matchs | ~${s.avgMarkets || 0} marches/m`);
  }
}
console.log('\n=== FIN ===');
