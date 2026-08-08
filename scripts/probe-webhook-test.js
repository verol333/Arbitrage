#!/usr/bin/env node
// PROBE WEBHOOK TEST — POST direct 1 opp foot + 1 basket + 1 tennis avec IDs
// uniques. Log la réponse complète du backend pour valider le pont scanner→DB
// sport par sport. Beaucoup plus rapide qu'un scan complet.

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
  console.error('❌ WEBHOOK_URL et WEBHOOK_SECRET requis');
  process.exit(1);
}

const stamp = Date.now();
const mkOpp = (sport, market, team) => ({
  sport,
  scan_id: `TEST-PROBE-${stamp}`,
  match_label: `TEST-PROBE-${sport}-${stamp} vs ADVERSAIRE-${stamp}`,
  team_home: `TEST-PROBE-${sport}-${stamp}`,
  team_away: `ADVERSAIRE-${stamp}`,
  league: `TEST-LEAGUE-${sport}`,
  kickoff_iso: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  market_family: market,
  leg_a_book: '1xbet',
  leg_a_label: 'A',
  leg_a_odd: 2.0,
  leg_b_book: 'sportybet',
  leg_b_label: 'B',
  leg_b_odd: 2.1,
  inverse_sum: 0.976,
  profit_pct: 2.44,
  stake_a_pct: 51.2,
  stake_b_pct: 48.8,
  is_live: false,
});

const payload = {
  type: 'arbitrage_alert',
  scan_type: 'prematch',
  sport: 'multi',
  sports: ['football', 'basket', 'tennis'],
  counts_by_sport: { football: 1, basket: 1, tennis: 1 },
  timestamp: new Date().toISOString(),
  count: 3,
  opportunities: [
    mkOpp('football', '1X2 — 2 + 1X', 'FOOT'),
    mkOpp('basket', 'Vainqueur du Match', 'BASKET'),
    mkOpp('tennis', 'Vainqueur du Match', 'TENNIS'),
  ],
};

console.log('▶ PROBE WEBHOOK TEST — 3 opps (1 foot + 1 basket + 1 tennis)');
console.log(`  scan_id: TEST-PROBE-${stamp}`);
console.log('  payload sports :', Object.keys(payload.counts_by_sport).map(s => `${s}=${payload.counts_by_sport[s]}`).join(' | '));
console.log('  opps :');
for (const o of payload.opportunities) {
  console.log(`    sport="${o.sport}" match="${o.match_label}" market="${o.market_family}"`);
}

const bodyStr = JSON.stringify(payload);
console.log(`\n▶ POST → ${WEBHOOK_URL} (${bodyStr.length}B)`);
const t0 = Date.now();
const res = await fetch(WEBHOOK_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Webhook-Secret': WEBHOOK_SECRET,
  },
  body: bodyStr,
  signal: AbortSignal.timeout(30_000),
});
const respText = await res.text();
const dt = Date.now() - t0;

console.log(`\n◀ HTTP ${res.status} (${dt}ms) response body:`);
console.log(respText);

console.log('\n═══════════════════════════════════════════════════════════');
console.log('DIAGNOSTIC :');
console.log('  Si response contient "stored_in_db_by_sport":');
console.log('    → chercher {football: 1, basket: 1, tennis: 1} = pont OK ✅');
console.log('    → autre chose = bug backend spécifique confirmé ❌');
console.log('  Si response ne contient PAS stored_in_db_by_sport :');
console.log('    → le webhook déployé n\'a pas encore le log réclamé ⚠️');
console.log('═══════════════════════════════════════════════════════════');
console.log(`\nscan_id à chercher en base : TEST-PROBE-${stamp}`);
