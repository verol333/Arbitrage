#!/usr/bin/env node
// Audit foot 1xbet : trigger scan foot rapide, pour CHAQUE opp qui inclut 1xbet
// re-fetch les cotes du match cote 1xbet, et compare avec la cote de l'opp.
// Detecte les fake arbs / decalages parseur.

import { runScan, log } from '../src/scanners/collect.js';
import { bookmakersByKey } from '../src/bookmakers/index.js';

log('▶▶▶ AUDIT FOOT 1XBET : scan + refetch + cross-check');

const result = await runScan({
  live: false,
  sport: 'football',
  minProfit: 0.3, // seuil bas pour capter plus d'opps a auditer
  horizonHours: 72,
});

const opps = result.opportunities || [];
log(`\n${opps.length} opps totales`);

const opps1xbet = opps.filter(o => o.leg_a_book === '1xbet' || o.leg_b_book === '1xbet');
log(`${opps1xbet.length} opps incluent 1xbet\n`);

if (!opps1xbet.length) { log('Aucune opp 1xbet, rien a auditer'); process.exit(0); }

// Grouper par match (l'id est dans verify.leg_a_match.id)
const byMatch = new Map();
for (const o of opps1xbet) {
  const mid = o.leg_a_book === '1xbet' ? o.verify?.leg_a_match?.id : o.verify?.leg_b_match?.id;
  const key = mid || o.match_label;
  if (!byMatch.has(key)) byMatch.set(key, { opps: [], matchId: mid, label: o.match_label });
  byMatch.get(key).opps.push(o);
}
log(`${byMatch.size} matchs distincts avec opps 1xbet\n`);

// Prendre top 5 matchs (les plus rentables)
const top3 = [...byMatch.entries()]
  .sort((a, b) => Math.max(...b[1].opps.map(o => o.profit_pct)) - Math.max(...a[1].opps.map(o => o.profit_pct)))
  .slice(0, 5);

const xbet = bookmakersByKey['1xbet'];

for (const [matchKey, { opps, matchId, label }] of top3) {
  log(`\n═══════════════════════════════════════════════════════════════════`);
  log(`MATCH: ${label} (id 1xbet=${matchId})`);
  log(`═══════════════════════════════════════════════════════════════════`);

  if (!matchId) { log('  (pas d\'id 1xbet exploitable)'); continue; }

  // Re-fetch cotes 1xbet du match
  let freshOdds = {};
  try {
    freshOdds = await xbet.getOdds({ id: matchId }, { live: false }) || {};
  } catch (e) {
    log(`  ERR re-fetch 1xbet: ${e.message}`);
    continue;
  }
  log(`\nCOTES 1XBET RE-FETCH (${Object.keys(freshOdds).length} cles):`);
  for (const [k, v] of Object.entries(freshOdds).sort()) {
    log(`  ${k.padEnd(30)} = ${v}`);
  }

  log(`\nOPPS DETECTEES (${opps.length}):`);
  for (const o of opps.sort((a, b) => b.profit_pct - a.profit_pct)) {
    const xbetIsA = o.leg_a_book === '1xbet';
    const xbetLabel = xbetIsA ? o.leg_a_label : o.leg_b_label;
    const xbetOdd = xbetIsA ? o.leg_a_odd : o.leg_b_odd;
    const otherBook = xbetIsA ? o.leg_b_book : o.leg_a_book;
    const otherLabel = xbetIsA ? o.leg_b_label : o.leg_a_label;
    const otherOdd = xbetIsA ? o.leg_b_odd : o.leg_a_odd;

    log(`\n  📊 ${o.profit_pct.toFixed(2)}% [${o.market_family}]`);
    log(`     1xbet    "${xbetLabel}" = ${xbetOdd}`);
    log(`     ${otherBook.padEnd(9)} "${otherLabel}" = ${otherOdd}`);

    // Chercher la cle correspondante dans freshOdds
    const xbetKey = keyForLabel(o.market_family, xbetLabel);
    if (xbetKey) {
      const freshVal = freshOdds[xbetKey];
      if (freshVal == null) {
        log(`     ⚠️  Cle ${xbetKey} ABSENTE du refetch → cotes disparue apres scan`);
      } else if (Math.abs(freshVal - xbetOdd) < 0.01) {
        log(`     ✅ 1xbet cote coherente refetch (${xbetKey}=${freshVal})`);
      } else {
        log(`     🔴 1xbet cote MISMATCH : scan=${xbetOdd} vs refetch=${freshVal} (cle ${xbetKey})`);
      }
    } else {
      log(`     ⚠️  Impossible de mapper label "${xbetLabel}" → cle`);
    }
  }
}

// Convertir "market_family" + "label" en cle interne pour verifier
function keyForLabel(family, label) {
  const fam = String(family || '');
  const lab = String(label || '').toLowerCase();
  // 1X2
  if (fam.startsWith('1X2 —') || fam === 'Match Winner') {
    if (/dom/i.test(lab)) return 'match_1';
    if (/nul/i.test(lab)) return 'match_X';
    if (/ext/i.test(lab)) return 'match_2';
  }
  // DC
  if (fam.includes('X2') && /nul.*ext/i.test(lab)) return 'dc_X2';
  if (fam.includes('1X') && /dom.*nul|nul.*dom/i.test(lab)) return 'dc_1X';
  if (fam.includes('12') && /gagnant.*12|un gagnant/i.test(lab)) return 'dc_12';
  // Handicap
  const hcpMatch = fam.match(/Handicap Asiatique\s*([+-]?\d+(?:\.\d+)?)/);
  if (hcpMatch) {
    const line = parseFloat(hcpMatch[1]);
    if (/dom/i.test(lab)) return `hcp_home_${line}`;
    if (/ext/i.test(lab)) return `hcp_away_${line}`;
  }
  // Total match
  const totMatch = fam.match(/Total Buts Match\s*(\d+(?:\.\d+)?)/);
  if (totMatch) {
    const line = parseFloat(totMatch[1]);
    if (/^\+/.test(lab) || /over|plus/i.test(lab)) return `match_over_${line}`;
    if (/^−|^-/.test(lab) || /under|moins/i.test(lab)) return `match_under_${line}`;
  }
  // Team totals
  const ttMatch = fam.match(/Total (Dom\.|Ext\.)\s*(\d+(?:\.\d+)?)/);
  if (ttMatch) {
    const side = ttMatch[1] === 'Dom.' ? 'home' : 'away';
    const line = parseFloat(ttMatch[2]);
    if (/^\+/.test(lab) || /over|plus/i.test(lab)) return `tt_${side}_over_${line}`;
    if (/^−|^-/.test(lab) || /under|moins/i.test(lab)) return `tt_${side}_under_${line}`;
  }
  // BTTS
  if (fam === 'BTTS' && /oui|yes/i.test(lab)) return 'btts_yes';
  if (fam === 'BTTS' && /non|no/i.test(lab)) return 'btts_no';
  // DNB
  if (fam === 'Draw No Bet' && /dom/i.test(lab)) return 'dnb_1';
  if (fam === 'Draw No Bet' && /ext/i.test(lab)) return 'dnb_2';
  return null;
}

log('\n▶▶▶ FIN AUDIT');
