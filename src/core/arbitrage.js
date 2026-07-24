// Détection d'arbitrages (surebets) sur cotes plates standardisées.
// Port fidèle de matchCore.ts (pushArb, pushArb3, compareTwoBooks).
// Garde-fous conservés : cote > 80 ou profit > 40% → rejet (cotes gelées/corrompues).
import { config } from '../config.js';
import { normalizeAliases } from './markets.js';

const MAX_ODD = 80;
const MAX_PROFIT = () => config.scan.maxProfitSanity;

export function pushArb(out, family, aLabel, aOdd, aBook, bLabel, bOdd, bBook) {
  if (!aOdd || !bOdd || aOdd <= 1 || bOdd <= 1) return;
  if (aOdd > MAX_ODD || bOdd > MAX_ODD) return;
  const invSum = 1 / aOdd + 1 / bOdd;
  if (invSum >= 1) return;
  const profit = (1 - invSum) * 100;
  if (profit > MAX_PROFIT()) return;
  const stakeA = (1 / aOdd) / invSum * 100;
  const stakeB = (1 / bOdd) / invSum * 100;
  out.push({
    market_family: family,
    leg_a_book: aBook, leg_a_label: aLabel, leg_a_odd: aOdd,
    leg_b_book: bBook, leg_b_label: bLabel, leg_b_odd: bOdd,
    inverse_sum: Math.round(invSum * 10000) / 10000,
    profit_pct: Math.round(profit * 100) / 100,
    stake_a_pct: Math.round(stakeA * 10) / 10,
    stake_b_pct: Math.round(stakeB * 10) / 10,
  });
}

// Arbitrage 3 jambes (marché à 3 issues exhaustives — ex : 1ère équipe à marquer).
export function pushArb3(out, family, l1, a1, ba1, b1, bb1, l2, a2, ba2, b2, bb2, l3, a3, ba3, b3, bb3) {
  const pick = (a, ba, b, bb) => ((a || 0) >= (b || 0) ? { odd: a || 0, book: ba } : { odd: b || 0, book: bb });
  const p1 = pick(a1, ba1, b1, bb1), p2 = pick(a2, ba2, b2, bb2), p3 = pick(a3, ba3, b3, bb3);
  if (p1.odd <= 1 || p2.odd <= 1 || p3.odd <= 1) return;
  if (p1.odd > MAX_ODD || p2.odd > MAX_ODD || p3.odd > MAX_ODD) return;
  const invSum = 1 / p1.odd + 1 / p2.odd + 1 / p3.odd;
  if (invSum >= 1) return;
  const profit = (1 - invSum) * 100;
  if (profit > MAX_PROFIT()) return;
  out.push({
    market_family: `${family} (3 issues)`,
    leg_a_book: p1.book, leg_a_label: l1, leg_a_odd: p1.odd,
    leg_b_book: p2.book, leg_b_label: `${l2} · ${l3} @${p3.odd.toFixed(2)} (${p3.book})`, leg_b_odd: p2.odd,
    inverse_sum: Math.round(invSum * 10000) / 10000,
    profit_pct: Math.round(profit * 100) / 100,
    stake_a_pct: Math.round((1 / p1.odd) / invSum * 1000) / 10,
    stake_b_pct: Math.round((1 / p2.odd) / invSum * 1000) / 10,
  });
}

const HCP_LINES = [-4.5, -3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5, 4.5];
const TT_LINES = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
const linesOf = (a, b, pattern) => {
  const set = new Set();
  for (const k of [...Object.keys(a), ...Object.keys(b)]) {
    const m = k.match(pattern);
    if (m) set.add(m[1]);
  }
  return set;
};

// Compare deux jeux de cotes plates 3-way (foot) entre 2 books quelconques.
// Traite : Total, 1X2+DC, DNB, Handicap, Total indiv., BTTS, Mi-temps, Corners,
// Pair/Impair, 1ère équipe à marquer, Mi-temps la plus prolifique.
export function compareTwoBooks(rawA, bookA, rawB, bookB) {
  const oa = normalizeAliases(rawA);
  const ob = normalizeAliases(rawB);
  const out = [];
  // Totaux buts plein temps.
  for (const l of linesOf(oa, ob, /^match_(?:over|under)_(\d+(?:\.\d+)?)$/)) {
    const fam = `Total match ${l}`;
    pushArb(out, fam, `+${l}`, oa[`match_over_${l}`], bookA, `−${l}`, ob[`match_under_${l}`], bookB);
    pushArb(out, fam, `+${l}`, ob[`match_over_${l}`], bookB, `−${l}`, oa[`match_under_${l}`], bookA);
  }
  // 1X2 croisés Double Chance.
  const dcPairs = [
    ['match_1', 'dc_X2', '1X2 — 1 + X2', 'Domicile', 'Nul ou Extérieur'],
    ['match_2', 'dc_1X', '1X2 — 2 + 1X', 'Extérieur', 'Domicile ou Nul'],
    ['match_X', 'dc_12', '1X2 — X + 12', 'Nul', 'Un gagnant (12)'],
  ];
  for (const [sk, dk, fam, aL, bL] of dcPairs) {
    pushArb(out, fam, aL, oa[sk], bookA, bL, ob[dk], bookB);
    pushArb(out, fam, aL, ob[sk], bookB, bL, oa[dk], bookA);
  }
  // Draw No Bet.
  pushArb(out, 'Draw No Bet', 'Domicile (DNB)', oa.dnb_1, bookA, 'Extérieur (DNB)', ob.dnb_2, bookB);
  pushArb(out, 'Draw No Bet', 'Domicile (DNB)', ob.dnb_1, bookB, 'Extérieur (DNB)', oa.dnb_2, bookA);
  // Handicaps ±L.
  for (const l of HCP_LINES) {
    const hk = `hcp_home_${l}`, ak = `hcp_away_${-l}`;
    const fam = `Handicap ${l > 0 ? '+' + l : l}`;
    const aL = `Dom. ${l > 0 ? '+' + l : l}`, bL = `Ext. ${-l > 0 ? '+' + (-l) : -l}`;
    pushArb(out, fam, aL, oa[hk], bookA, bL, ob[ak], bookB);
    pushArb(out, fam, aL, ob[hk], bookB, bL, oa[ak], bookA);
  }
  // Totaux individuels dom./ext.
  for (const [side, lbl] of [['home', 'Dom.'], ['away', 'Ext.']]) {
    for (const l of TT_LINES) {
      const ok = `tt_${side}_over_${l}`, uk = `tt_${side}_under_${l}`;
      const fam = `Total ${lbl} ${l}`;
      pushArb(out, fam, `${lbl} +${l}`, oa[ok], bookA, `${lbl} −${l}`, ob[uk], bookB);
      pushArb(out, fam, `${lbl} +${l}`, ob[ok], bookB, `${lbl} −${l}`, oa[uk], bookA);
    }
  }
  // BTTS.
  pushArb(out, 'BTTS', 'Oui', oa.btts_yes, bookA, 'Non', ob.btts_no, bookB);
  pushArb(out, 'BTTS', 'Oui', ob.btts_yes, bookB, 'Non', oa.btts_no, bookA);
  // Totaux mi-temps et corners.
  for (const [pfx, lbl] of [['ht_', '1MT Total'], ['h2_', '2MT Total'], ['cor_', 'Corners Total']]) {
    for (const l of linesOf(oa, ob, new RegExp(`^${pfx}(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
      const ok = `${pfx}over_${l}`, uk = `${pfx}under_${l}`;
      const fam = `${lbl} ${l}`;
      pushArb(out, fam, `+${l}`, oa[ok], bookA, `−${l}`, ob[uk], bookB);
      pushArb(out, fam, `+${l}`, ob[ok], bookB, `−${l}`, oa[uk], bookA);
    }
  }
  // 1X2+DC mi-temps.
  for (const [pfx, lbl] of [['ht_', '1MT'], ['h2_', '2MT']]) {
    for (const [sk, dk, aL, bL] of [
      ['match_1', 'dc_X2', 'Domicile', 'Nul ou Ext.'],
      ['match_2', 'dc_1X', 'Extérieur', 'Dom. ou Nul'],
      ['match_X', 'dc_12', 'Nul', 'Un gagnant'],
    ]) {
      pushArb(out, `${lbl} 1X2 — ${aL}`, aL, oa[`${pfx}${sk}`], bookA, bL, ob[`${pfx}${dk}`], bookB);
      pushArb(out, `${lbl} 1X2 — ${aL}`, aL, ob[`${pfx}${sk}`], bookB, bL, oa[`${pfx}${dk}`], bookA);
    }
  }
  // BTTS par mi-temps.
  for (const [pfx, lbl] of [['ht_', '1MT BTTS'], ['h2_', '2MT BTTS']]) {
    pushArb(out, lbl, 'Oui', oa[`${pfx}btts_yes`], bookA, 'Non', ob[`${pfx}btts_no`], bookB);
    pushArb(out, lbl, 'Oui', ob[`${pfx}btts_yes`], bookB, 'Non', oa[`${pfx}btts_no`], bookA);
  }
  // DNB par mi-temps.
  pushArb(out, '1MT Draw No Bet', 'Dom. (DNB)', oa.ht_dnb_1, bookA, 'Ext. (DNB)', ob.ht_dnb_2, bookB);
  pushArb(out, '1MT Draw No Bet', 'Dom. (DNB)', ob.ht_dnb_1, bookB, 'Ext. (DNB)', oa.ht_dnb_2, bookA);
  pushArb(out, '2MT Draw No Bet', 'Dom. (DNB)', oa.h2_dnb_1, bookA, 'Ext. (DNB)', ob.h2_dnb_2, bookB);
  pushArb(out, '2MT Draw No Bet', 'Dom. (DNB)', ob.h2_dnb_1, bookB, 'Ext. (DNB)', oa.h2_dnb_2, bookA);
  // Pair/Impair.
  pushArb(out, 'Pair/Impair', 'Impair', oa.odd, bookA, 'Pair', ob.even, bookB);
  pushArb(out, 'Pair/Impair', 'Impair', ob.odd, bookB, 'Pair', oa.even, bookA);
  for (const [pfx, lbl] of [['ht_', '1MT Pair/Impair'], ['h2_', '2MT Pair/Impair']]) {
    pushArb(out, lbl, 'Impair', oa[`${pfx}odd`], bookA, 'Pair', ob[`${pfx}even`], bookB);
    pushArb(out, lbl, 'Impair', ob[`${pfx}odd`], bookB, 'Pair', oa[`${pfx}even`], bookA);
  }
  // Handicap par mi-temps.
  for (const [pfx, lbl] of [['ht_', '1MT Handicap'], ['h2_', '2MT Handicap']]) {
    for (const l of HCP_LINES) {
      const hk = `${pfx}hcp_home_${l}`, ak = `${pfx}hcp_away_${-l}`;
      const fam = `${lbl} ${l > 0 ? '+' + l : l}`;
      pushArb(out, fam, `Dom. ${l > 0 ? '+' + l : l}`, oa[hk], bookA, `Ext. ${-l > 0 ? '+' + (-l) : -l}`, ob[ak], bookB);
      pushArb(out, fam, `Dom. ${l > 0 ? '+' + l : l}`, ob[hk], bookB, `Ext. ${-l > 0 ? '+' + (-l) : -l}`, oa[ak], bookA);
    }
  }
  // Totaux individuels par mi-temps.
  for (const [pfx, lbl] of [['ht_', '1MT'], ['h2_', '2MT']]) {
    for (const [side, teamLbl] of [['home', 'Dom.'], ['away', 'Ext.']]) {
      for (const l of TT_LINES) {
        const ok = `${pfx}tt_${side}_over_${l}`, uk = `${pfx}tt_${side}_under_${l}`;
        const fam = `${lbl} Total ${teamLbl} ${l}`;
        pushArb(out, fam, `${teamLbl} +${l}`, oa[ok], bookA, `${teamLbl} −${l}`, ob[uk], bookB);
        pushArb(out, fam, `${teamLbl} +${l}`, ob[ok], bookB, `${teamLbl} −${l}`, oa[uk], bookA);
      }
    }
  }
  // Corners handicap.
  for (const l of linesOf(oa, ob, /^cor_hcp_home_(-?\d+(?:\.\d+)?)$/)) {
    const hk = `cor_hcp_home_${l}`, ak = `cor_hcp_away_${-parseFloat(l)}`;
    const fam = `Corners Handicap ${parseFloat(l) > 0 ? '+' + l : l}`;
    pushArb(out, fam, `Dom. ${parseFloat(l) > 0 ? '+' + l : l}`, oa[hk], bookA, `Ext. ${-parseFloat(l) > 0 ? '+' + (-parseFloat(l)) : -parseFloat(l)}`, ob[ak], bookB);
    pushArb(out, fam, `Dom. ${parseFloat(l) > 0 ? '+' + l : l}`, ob[hk], bookB, `Ext. ${-parseFloat(l) > 0 ? '+' + (-parseFloat(l)) : -parseFloat(l)}`, oa[ak], bookA);
  }
  // Corners pair/impair.
  pushArb(out, 'Corners Pair/Impair', 'Impair', oa.cor_odd, bookA, 'Pair', ob.cor_even, bookB);
  pushArb(out, 'Corners Pair/Impair', 'Impair', ob.cor_odd, bookB, 'Pair', oa.cor_even, bookA);
  // Corners 1MT total.
  for (const l of linesOf(oa, ob, /^cor_ht_(?:over|under)_(\d+(?:\.\d+)?)$/)) {
    pushArb(out, `Corners 1MT Total ${l}`, `+${l}`, oa[`cor_ht_over_${l}`], bookA, `−${l}`, ob[`cor_ht_under_${l}`], bookB);
    pushArb(out, `Corners 1MT Total ${l}`, `+${l}`, ob[`cor_ht_over_${l}`], bookB, `−${l}`, oa[`cor_ht_under_${l}`], bookA);
  }
  // HT/H2 individual totals.
  for (const [pfx, lbl] of [['ht_', '1MT'], ['h2_', '2MT']]) {
    for (const [side, teamLbl] of [['home', 'Dom.'], ['away', 'Ext.']]) {
      for (const l of linesOf(oa, ob, new RegExp(`^${pfx}tt_${side}_(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
        const ok = `${pfx}tt_${side}_over_${l}`, uk = `${pfx}tt_${side}_under_${l}`;
        const fam = `${lbl} Total ${teamLbl} ${l}`;
        pushArb(out, fam, `${teamLbl} +${l}`, oa[ok], bookA, `${teamLbl} −${l}`, ob[uk], bookB);
        pushArb(out, fam, `${teamLbl} +${l}`, ob[ok], bookB, `${teamLbl} −${l}`, oa[uk], bookA);
      }
    }
  }
  // 3-way : 1ère équipe à marquer + mi-temps la plus prolifique.
  pushArb3(out, '1ère équipe à marquer',
    'Domicile marque en 1er', oa.fts_home, bookA, ob.fts_home, bookB,
    'Extérieur marque en 1er', oa.fts_away, bookA, ob.fts_away, bookB,
    'Aucun but', oa.fts_none, bookA, ob.fts_none, bookB);
  pushArb3(out, 'Mi-temps la plus prolifique',
    '1ère MT', oa.half_most_ht, bookA, ob.half_most_ht, bookB,
    '2ème MT', oa.half_most_h2, bookA, ob.half_most_h2, bookB,
    'Égalité', oa.half_most_equal, bookA, ob.half_most_equal, bookB);
  return out;
}

// Dédup neutre sur l'ordre A/B (le même arbitrage entre 2 books peut être détecté
// deux fois par des paires symétriques — on ne veut qu'une entrée par jambe exacte).
export function dedupeOpportunities(opps) {
  const seen = new Set();
  const out = [];
  for (const o of opps) {
    const legA = `${o.leg_a_book}:${o.leg_a_label}@${o.leg_a_odd}`;
    const legB = `${o.leg_b_book}:${o.leg_b_label}@${o.leg_b_odd}`;
    const key = [legA, legB].sort().join('||') + '|' + (o.market_family || '') + '|' + (o.match_label || '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}
