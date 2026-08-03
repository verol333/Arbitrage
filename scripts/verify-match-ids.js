#!/usr/bin/env node
// Verifie que les matchIds referencent bien le match dit dans l'opp
// (detecte les mauvaises appariations equipes cross-book).
import { runScan, log } from '../src/scanners/collect.js';
import { bookmakersByKey } from '../src/bookmakers/index.js';

const result = await runScan({
  live: false, sport: 'football',
  minProfit: 0.3, horizonHours: 72,
});
const opps = result.opportunities || [];
log(`\n${opps.length} opps envoyees\n`);
if (!opps.length) process.exit(0);

const top = opps.sort((a, b) => b.profit_pct - a.profit_pct).slice(0, 5);

for (const o of top) {
  log('\n════════════════════════════════════════════════════════════════');
  log(`OPP ${o.profit_pct.toFixed(2)}% [${o.market_family}]`);
  log(`  Label opp : "${o.match_label}"`);
  log(`  Teams full : ${o.team_home_full} vs ${o.team_away_full}`);
  log(`  Kickoff : ${o.kickoff_iso}`);
  log('');

  // Pour chaque leg, refetch le match complet chez le book et dumper les équipes
  for (const leg of ['a', 'b']) {
    const book = o[`leg_${leg}_book`];
    const mid = o.verify?.[`leg_${leg}_match`]?.id;
    if (!book || !mid) continue;

    log(`  ─── ${book.toUpperCase()} id=${mid} ───`);

    // Refetch la liste et chercher ce match
    const b = bookmakersByKey[book];
    try {
      const matches = await b.listMatches({ live: false, horizonHours: 72, sport: 'football' });
      const found = matches.find(m => String(m.id) === String(mid));
      if (found) {
        log(`    Home : ${found.home}`);
        log(`    Away : ${found.away}`);
        log(`    League : ${found.league || '?'}`);
        log(`    Start : ${found.start ? new Date(found.start).toISOString() : '?'}`);
        // Verifier alignement
        const okHome = (found.home || '').toLowerCase().includes(String(o.team_home_full || '').toLowerCase().slice(0, 6));
        const okAway = (found.away || '').toLowerCase().includes(String(o.team_away_full || '').toLowerCase().slice(0, 6));
        if (okHome && okAway) log(`    ✅ Correspondance OK`);
        else log(`    🔴 MISMATCH avec opp (opp dit "${o.team_home_full} vs ${o.team_away_full}")`);
      } else {
        log(`    🔴 Match id=${mid} PAS TROUVE dans liste actuelle ${book}`);
      }
    } catch (e) { log(`    ERR ${e.message}`); }
  }
}
log('\n═══ FIN ═══');
