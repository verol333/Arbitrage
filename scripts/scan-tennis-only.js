#!/usr/bin/env node
// Scan TENNIS uniquement — pas de persistence Base44, pas de webhook.
// Objectif : lister les opportunites cross-books tennis pour validation manuelle
// AVANT branchement en prod. Log verbose avec details par book/marche.

import { runScan, log } from '../src/scanners/collect.js';

const t0 = Date.now();
log('▶▶▶ SCAN TENNIS ONLY (validation avant branchement prod)');

const result = await runScan({
  live: false,
  sport: 'tennis',
  minProfit: Number(process.env.MIN_PROFIT_PREMATCH || 0.5),
  horizonHours: Number(process.env.HORIZON_HOURS || 72),
});

const opps = result.opportunities || [];
log(`\n▶▶▶ TERMINE en ${Date.now() - t0}ms — ${opps.length} opportunites TENNIS confirmees`);

if (opps.length === 0) {
  log('  (aucune opportunite tennis trouvee)');
  process.exit(0);
}

// Grouper par match
const byMatch = new Map();
for (const o of opps) {
  const key = o.match_label || `${o.team_home_full}-${o.team_away_full}`;
  if (!byMatch.has(key)) byMatch.set(key, []);
  byMatch.get(key).push(o);
}

log(`\n=== ${byMatch.size} matchs avec opportunites ===\n`);

let idx = 1;
const sortedMatches = [...byMatch.entries()].sort((a, b) =>
  Math.max(...b[1].map(o => o.profit_pct)) - Math.max(...a[1].map(o => o.profit_pct)),
);

for (const [matchLabel, matchOpps] of sortedMatches) {
  const first = matchOpps[0];
  log(`─── #${idx++} ${matchLabel} (${matchOpps.length} opp${matchOpps.length > 1 ? 's' : ''}) ───`);
  log(`  ligue: ${first.league || '?'} | kickoff: ${first.kickoff_iso || '?'}`);
  for (const o of matchOpps.sort((a, b) => b.profit_pct - a.profit_pct)) {
    log(`  📊 ${o.profit_pct.toFixed(2)}% [${o.market_family}]`);
    log(`     A: ${o.leg_a_book.padEnd(11)} "${o.leg_a_label}" = ${o.leg_a_odd}`);
    log(`     B: ${o.leg_b_book.padEnd(11)} "${o.leg_b_label}" = ${o.leg_b_odd}`);
  }
  log('');
}

log(`\n=== RESUME PAR BOOKMAKER (apparitions dans les opps) ===`);
const bookCount = {};
for (const o of opps) {
  bookCount[o.leg_a_book] = (bookCount[o.leg_a_book] || 0) + 1;
  bookCount[o.leg_b_book] = (bookCount[o.leg_b_book] || 0) + 1;
}
for (const [book, n] of Object.entries(bookCount).sort((a, b) => b[1] - a[1])) {
  log(`  ${book.padEnd(12)} ${n}`);
}

log(`\n=== STATS SCAN ===`);
if (result.stats) {
  log(`  catalogs: ${JSON.stringify(result.stats.catalogs || [])}`);
  log(`  entries: ${result.stats.entries || 0}`);
  log(`  duration_ms: ${result.stats.duration_ms || 0}`);
}
