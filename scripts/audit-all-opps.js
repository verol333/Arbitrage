#!/usr/bin/env node
// AUDIT COMPLET : scan foot, pour CHAQUE opp refetch cotes fraiches (noCache=true)
// sur les 2 books puis compare. But : identifier fake arbs / stale cache.
// Sortie synthese : nb OK / drift / stale / disparu.

import { runScan, log } from '../src/scanners/collect.js';
import { bookmakersByKey } from '../src/bookmakers/index.js';

log('▶▶▶ AUDIT COMPLET DE TOUTES LES OPPS FOOT ENVOYEES');

const result = await runScan({
  live: false, sport: 'football',
  minProfit: 0.3, horizonHours: 72,
});

const opps = (result.opportunities || []).sort((a, b) => b.profit_pct - a.profit_pct);
log(`\n${opps.length} opps envoyees a l'app\n`);
if (!opps.length) { log('Aucune opp'); process.exit(0); }

function keyForFootLabel(family, label) {
  const fam = String(family || '');
  const lab = String(label || '').toLowerCase();
  if (/1X2/i.test(fam)) {
    if (/dom.*nul|nul.*dom/i.test(lab)) return 'dc_1X';
    if (/nul.*ext|ext.*nul/i.test(lab)) return 'dc_X2';
    if (/gagnant|un gagnant|dom.*ext|ext.*dom|12/i.test(lab) && !/nul/i.test(lab)) return 'dc_12';
    if (/^dom(icile)?\s*$/i.test(lab) || (/dom/i.test(lab) && !/ou|nul|ext/i.test(lab))) return 'match_1';
    if (/^nul\s*$/i.test(lab) || (/nul/i.test(lab) && !/ou|dom|ext/i.test(lab))) return 'match_X';
    if (/^ext(érieur)?\s*$/i.test(lab) || (/ext/i.test(lab) && !/ou|dom|nul/i.test(lab))) return 'match_2';
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

// Stats globales
const stats = {
  total_opps: opps.length,
  legs_ok: 0,         // cote refetch = cote scan (±0.02)
  legs_drift_small: 0, // drift 0.02-0.10
  legs_drift_big: 0,   // drift > 0.10 => stale/fake
  legs_missing: 0,     // cle absente du refetch
  legs_map_fail: 0,    // label non mappable
  legs_err: 0,         // erreur refetch
  legs_no_id: 0,
};
const byBook = {}; // book => {ok, drift_small, drift_big, missing, err}
function bumpBook(book, kind) {
  if (!byBook[book]) byBook[book] = { ok:0, drift_small:0, drift_big:0, missing:0, err:0, no_id:0, map_fail:0 };
  byBook[book][kind]++;
}

// Cache pour eviter de refetcher le meme match 2x dans le meme audit
const cache = new Map(); // key `${book}:${id}` => Promise<odds>
async function refetch(book, mid, home, away) {
  const key = `${book}:${mid}`;
  if (cache.has(key)) return cache.get(key);
  const b = bookmakersByKey[book];
  const p = b.getOdds({ id: mid, home, away }, { live: false, noCache: true }).catch(e => ({ __err: e.message }));
  cache.set(key, p);
  return p;
}

const suspicious = []; // opps a signaler

for (let i = 0; i < opps.length; i++) {
  const o = opps[i];
  log(`\n[${i+1}/${opps.length}] ${o.profit_pct.toFixed(2)}% [${o.market_family}]`);
  log(`  ${o.match_label}`);
  log(`  A: ${o.leg_a_book} "${o.leg_a_label}" = ${o.leg_a_odd}`);
  log(`  B: ${o.leg_b_book} "${o.leg_b_label}" = ${o.leg_b_odd}`);

  let oppOk = true;
  const legReports = [];

  for (const leg of ['a', 'b']) {
    const book = o[`leg_${leg}_book`];
    const label = o[`leg_${leg}_label`];
    const odd = o[`leg_${leg}_odd`];
    const mid = o.verify?.[`leg_${leg}_match`]?.id;
    if (!book || !mid) { stats.legs_no_id++; bumpBook(book || '?', 'no_id'); legReports.push(`${leg}:noid`); oppOk = false; continue; }

    const fresh = await refetch(book, mid, o.team_home_full, o.team_away_full);
    if (fresh.__err) { stats.legs_err++; bumpBook(book, 'err'); legReports.push(`${leg}:err(${fresh.__err.slice(0,20)})`); oppOk = false; continue; }

    const wantKey = keyForFootLabel(o.market_family, label);
    if (!wantKey) { stats.legs_map_fail++; bumpBook(book, 'map_fail'); legReports.push(`${leg}:mapfail`); continue; }

    const freshVal = fresh[wantKey];
    if (freshVal == null) {
      stats.legs_missing++; bumpBook(book, 'missing');
      legReports.push(`  🔴 ${leg} ${book}: ${wantKey} ABSENTE (opp=${odd})`);
      oppOk = false;
    } else {
      const drift = Math.abs(freshVal - odd);
      if (drift < 0.02) { stats.legs_ok++; bumpBook(book, 'ok'); legReports.push(`  ✅ ${leg} ${book}: ${wantKey} opp=${odd} refetch=${freshVal}`); }
      else if (drift < 0.10) { stats.legs_drift_small++; bumpBook(book, 'drift_small'); legReports.push(`  🟡 ${leg} ${book}: ${wantKey} opp=${odd} refetch=${freshVal} drift=${drift.toFixed(2)}`); }
      else { stats.legs_drift_big++; bumpBook(book, 'drift_big'); legReports.push(`  🔴 ${leg} ${book}: ${wantKey} opp=${odd} refetch=${freshVal} DRIFT=${drift.toFixed(2)}`); oppOk = false; }
    }
  }
  for (const r of legReports) log('    ' + r);
  if (!oppOk) suspicious.push({ opp: o, reports: legReports });
}

log('\n\n════════════════════ SYNTHESE GLOBALE ════════════════════');
log(`Opps totales : ${stats.total_opps}`);
log(`Legs OK      : ${stats.legs_ok}`);
log(`Legs drift <0.10 : ${stats.legs_drift_small}`);
log(`Legs drift >0.10 (fake/stale) : ${stats.legs_drift_big}`);
log(`Legs cle absente refetch : ${stats.legs_missing}`);
log(`Legs label non mappable : ${stats.legs_map_fail}`);
log(`Legs erreur refetch : ${stats.legs_err}`);
log(`Legs sans id : ${stats.legs_no_id}`);
log(`\nOpps SUSPECTES (fake/stale) : ${suspicious.length}/${stats.total_opps}`);

log('\n── Detail par bookmaker ──');
for (const [book, s] of Object.entries(byBook).sort()) {
  const total = s.ok + s.drift_small + s.drift_big + s.missing + s.err + s.no_id + s.map_fail;
  const pctOk = total ? Math.round(100 * s.ok / total) : 0;
  log(`  ${book.padEnd(12)} total=${total} ok=${s.ok}(${pctOk}%) drift_s=${s.drift_small} drift_BIG=${s.drift_big} missing=${s.missing} err=${s.err} noid=${s.no_id} mapfail=${s.map_fail}`);
}

log('\n── Opps a examiner ──');
for (const { opp: o, reports } of suspicious.slice(0, 20)) {
  log(`\n  ${o.profit_pct.toFixed(2)}% ${o.match_label} [${o.market_family}]`);
  log(`    ${o.leg_a_book} ${o.leg_a_label}=${o.leg_a_odd} vs ${o.leg_b_book} ${o.leg_b_label}=${o.leg_b_odd}`);
  for (const r of reports.filter(r => /🔴|missing|err|drift_big/.test(r))) log('    ' + r);
}

log('\n═══ FIN AUDIT ═══');
