#!/usr/bin/env node
// PROBE WEBHOOK TEST v2 — POST direct avec logs COMPLETS pour dev backend.
// Change vs v1 : log URL fingerprint, réponse HTTP COMPLETE (pas tronquée),
// headers, et parse JSON pour extraire stored_in_db_by_sport si présent.
import { createHash } from 'crypto';

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
  console.error('❌ WEBHOOK_URL et WEBHOOK_SECRET requis');
  process.exit(1);
}

// URL fingerprint : SHA256 tronqué (permet au dev de vérifier que scanner tape
// bien le même endpoint que celui qu'il teste directement).
const urlHash = createHash('sha256').update(WEBHOOK_URL).digest('hex').slice(0, 16);
const urlHost = new URL(WEBHOOK_URL).host;
const urlPath = new URL(WEBHOOK_URL).pathname;
const secretHash = createHash('sha256').update(WEBHOOK_SECRET).digest('hex').slice(0, 12);

const stamp = Date.now();
const mkOpp = (sport, market) => ({
  sport,
  scan_id: `PROBE-V2-${stamp}`,
  match_label: `PROBE-V2-${sport.toUpperCase()}-${stamp} vs OPPOSER-${stamp}`,
  team_home: `PROBE-V2-${sport.toUpperCase()}-${stamp}`,
  team_away: `OPPOSER-${stamp}`,
  league: `PROBE-LEAGUE-${sport}`,
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
    mkOpp('football', '1X2 — 2 + 1X'),
    mkOpp('basket', 'Vainqueur du Match'),
    mkOpp('tennis', 'Vainqueur du Match'),
  ],
};

console.log('▶ PROBE WEBHOOK TEST v2');
console.log(`  URL fingerprint : host=${urlHost} path=${urlPath} sha256[16]=${urlHash}`);
console.log(`  Secret fingerprint : sha256[12]=${secretHash} (len=${WEBHOOK_SECRET.length})`);
console.log(`  scan_id : PROBE-V2-${stamp}`);
console.log(`  Payload sports : football=1 basket=1 tennis=1 (opps avec .sport individuel)`);
console.log(`  Opps envoyés :`);
for (const o of payload.opportunities) {
  console.log(`    sport="${o.sport}" match_label="${o.match_label}"`);
}

const bodyStr = JSON.stringify(payload);
console.log(`\n▶ POST → https://${urlHost}${urlPath} (bodySize=${bodyStr.length}B)`);

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
const dt = Date.now() - t0;
const respText = await res.text();

console.log(`\n◀ HTTP ${res.status} ${res.statusText} (${dt}ms)`);
console.log(`  Response headers :`);
for (const [k, v] of res.headers.entries()) console.log(`    ${k}: ${v}`);
console.log(`  Response body FULL (non tronqué, ${respText.length}B) :`);
console.log('  ' + respText.split('\n').join('\n  '));

// Parse & analyse
let parsed = null;
try { parsed = JSON.parse(respText); } catch { /* ignore */ }
if (parsed) {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('DIAGNOSTIC AUTO :');
  console.log(`  Reçu par backend : received=${parsed.received} inserted=${parsed.inserted}`);
  if (parsed.requested_by_sport) {
    console.log(`  ✅ requested_by_sport ACTIF : ${JSON.stringify(parsed.requested_by_sport)}`);
  } else {
    console.log('  ❌ requested_by_sport ABSENT — nouvelle instrumentation backend PAS DÉPLOYÉE');
  }
  if (parsed.stored_in_db_by_sport) {
    console.log(`  ✅ stored_in_db_by_sport ACTIF : ${JSON.stringify(parsed.stored_in_db_by_sport)}`);
    const s = parsed.stored_in_db_by_sport;
    if (s.football === 1 && s.basket === 1 && s.tennis === 1) {
      console.log('  🎯 PONT COMPLET OK — 3 sports insérés (foot+basket+tennis)');
    } else {
      console.log('  ⚠️ PONT PARTIEL — certains sports non insérés :');
      for (const sport of ['football', 'basket', 'tennis']) {
        const got = s[sport] ?? 0;
        console.log(`     ${sport}: envoyé=1 stocké=${got} ${got === 1 ? '✅' : '❌'}`);
      }
    }
  } else {
    console.log('  ❌ stored_in_db_by_sport ABSENT — instrumentation dev PAS ENCORE DÉPLOYÉE');
    console.log('     → dev doit déployer son log stored_in_db_by_sport avant de trancher');
  }
  console.log('═══════════════════════════════════════════════════════════');
}
console.log(`\n🔍 Dev doit chercher en base : scan_id = "PROBE-V2-${stamp}"`);
console.log(`   Requête : SELECT sport, match_label FROM ArbitrageOpportunity WHERE scan_id = 'PROBE-V2-${stamp}';`);
