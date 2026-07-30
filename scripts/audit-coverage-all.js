#!/usr/bin/env node
// Audit complet : combien de matchs + marchés par book x sport
// Objectif : verifier qu'on recupere le max possible

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

    // Pour les 3 premiers matchs, essayer d'extraire les cotes pour compter les marchés
    if (matches.length > 0 && book.getOdds) {
      let totalMarkets = 0;
      let sampled = 0;
      const sample = matches.slice(0, 3);
      for (const m of sample) {
        try {
          const odds = await book.getOdds(m, { sport, live: false });
          const nKeys = Object.keys(odds || {}).length;
          totalMarkets += nKeys;
          sampled++;
        } catch { /* skip */ }
      }
      const avgMarkets = sampled > 0 ? Math.round(totalMarkets / sampled) : 0;
      summary[sport][book.key].avgMarkets = avgMarkets;
      console.log(`     ↳ ~${avgMarkets} marchés/match (echantillon ${sampled}/3)`);
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
