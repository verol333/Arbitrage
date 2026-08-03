#!/usr/bin/env node
// AUDIT foot multi-books : pour chaque opp envoyee, refetch cotes FRAICHES
// (noCache=true) sur les 2 books concernes puis compare avec cotes de l'opp.
// Objectif : detecter si les cotes captees sont stale (cache) vs live.

import { runScan, log } from '../src/scanners/collect.js';
import { bookmakersByKey } from '../src/bookmakers/index.js';

log('▶▶▶ AUDIT FOOT MULTI-BOOKS : detection cotes stales via refetch fresh');

const result = await runScan({
  live: false,
  sport: 'football',
  minProfit: 0.3,
  horizonHours: 72,
});

const opps = result.opportunities || [];
log(`\n${opps.length} opps envoyees\n`);
if (!opps.length) { log('Aucune opp'); process.exit(0); }

// Prendre top 5 opps par profit
const top = opps.sort((a, b) => b.profit_pct - a.profit_pct).slice(0, 5);

// Map key foot → refetch checker (label → cle interne)
function keyForFootLabel(family, label) {
  const fam = String(family || '');
  const lab = String(label || '').toLowerCase();
  // 1X2
  if (/1X2 —/.test(fam) || fam === 'Match Winner') {
    if (/dom/i.test(lab)) return 'match_1';
    if (/nul.*ext|ext.*nul|dc_x2/i.test(lab)) return 'dc_X2';
    if (/nul/i.test(lab)) return 'match_X';
    if (/^ext|extérieur$|^extérieur\s*$/i.test(lab)) return 'match_2';
    if (/dom.*nul|nul.*dom/i.test(lab)) return 'dc_1X';
    if (/gagnant|dc_12|dom.*ext|ext.*dom/i.test(lab)) return 'dc_12';
  }
  const hcp = fam.match(/Handicap Asiatique\s*([+-]?\d+(?:\.\d+)?)/);
  if (hcp) {
    const l = parseFloat(hcp[1]);
    if (/dom/i.test(lab)) return `hcp_home_${l}`;
    if (/ext/i.test(lab)) return `hcp_away_${l}`;
  }
  const tot = fam.match(/Total Buts Match\s*(\d+(?:\.\d+)?)/);
  if (tot) {
    const l = parseFloat(tot[1]);
    if (/^\+|over/i.test(lab)) return `match_over_${l}`;
    if (/^−|^-|under/i.test(lab)) return `match_under_${l}`;
  }
  const tt = fam.match(/Total (Dom\.|Ext\.)\s*(\d+(?:\.\d+)?)/);
  if (tt) {
    const side = tt[1] === 'Dom.' ? 'home' : 'away';
    const l = parseFloat(tt[2]);
    if (/^\+|over/i.test(lab)) return `tt_${side}_over_${l}`;
    if (/^−|^-|under/i.test(lab)) return `tt_${side}_under_${l}`;
  }
  if (fam === 'BTTS' && /oui|yes/i.test(lab)) return 'btts_yes';
  if (fam === 'BTTS' && /non|no/i.test(lab)) return 'btts_no';
  if (fam === 'Draw No Bet' && /dom/i.test(lab)) return 'dnb_1';
  if (fam === 'Draw No Bet' && /ext/i.test(lab)) return 'dnb_2';
  return null;
}

for (const o of top) {
  log('\n════════════════════════════════════════════════════════════════');
  log(`OPP ${o.profit_pct.toFixed(2)}% [${o.market_family}]`);
  log(`  Match: ${o.match_label}`);
  log(`  Leg A: ${o.leg_a_book} "${o.leg_a_label}" = ${o.leg_a_odd}`);
  log(`  Leg B: ${o.leg_b_book} "${o.leg_b_label}" = ${o.leg_b_odd}`);

  const midA = o.verify?.leg_a_match?.id;
  const midB = o.verify?.leg_b_match?.id;
  log(`  IDs match: ${o.leg_a_book}=${midA} | ${o.leg_b_book}=${midB}`);

  // Refetch pour chaque leg
  for (const leg of ['a', 'b']) {
    const book = o[`leg_${leg}_book`];
    const label = o[`leg_${leg}_label`];
    const odd = o[`leg_${leg}_odd`];
    const mid = o.verify?.[`leg_${leg}_match`]?.id;
    const b = bookmakersByKey[book];
    if (!b || !mid) { log(`  Leg ${leg}: pas d'id/book`); continue; }

    log(`\n  🔄 REFETCH ${book} (id=${mid}) — noCache=true`);
    let fresh = {};
    try {
      fresh = await b.getOdds({ id: mid, home: o.team_home_full, away: o.team_away_full }, { live: false, noCache: true }) || {};
    } catch (e) { log(`    ERR ${e.message}`); continue; }
    log(`    ${Object.keys(fresh).length} cles refetch`);

    const wantKey = keyForFootLabel(o.market_family, label);
    if (!wantKey) { log(`    ⚠️ Impossible mapper label "${label}" → cle`); continue; }
    const freshVal = fresh[wantKey];
    if (freshVal == null) {
      log(`    🔴 CLE ${wantKey} ABSENTE refetch (opp disait ${odd})`);
      // Chercher cles proches
      const near = Object.keys(fresh).filter(k => k.includes(wantKey.split('_')[0]));
      if (near.length) log(`      Cles proches : ${near.slice(0, 5).map(k => `${k}=${fresh[k]}`).join(' | ')}`);
    } else {
      const drift = Math.abs(freshVal - odd);
      if (drift < 0.02) log(`    ✅ ${wantKey}: opp=${odd} refetch=${freshVal} (idem)`);
      else if (drift < 0.10) log(`    🟡 ${wantKey}: opp=${odd} refetch=${freshVal} drift=${drift.toFixed(2)}`);
      else log(`    🔴 ${wantKey}: opp=${odd} vs refetch=${freshVal} DRIFT=${drift.toFixed(2)} — probable stale`);
    }
  }
}

log('\n═══ FIN AUDIT ═══');
