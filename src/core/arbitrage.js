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
    const fam = `Total Buts Match ${l}`;
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
  // Handicaps ASIATIQUES ±L (demi-lignes, 2-way sans nul). Label explicite
  // pour distinguer du Handicap Européen 3-way (non traité ici).
  for (const l of HCP_LINES) {
    const hk = `hcp_home_${l}`, ak = `hcp_away_${-l}`;
    const fam = `Handicap Asiatique ${l > 0 ? '+' + l : l}`;
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
  for (const [pfx, lbl] of [['ht_', '1MT Total Buts'], ['h2_', '2MT Total Buts'], ['cor_', 'Corners Total']]) {
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
  // Handicap Asiatique par mi-temps (demi-lignes, 2-way).
  for (const [pfx, lbl] of [['ht_', '1MT Handicap Asiatique'], ['h2_', '2MT Handicap Asiatique']]) {
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
  // HT/H2 individual totals (par mi-temps).
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
  // Full-match individual totals (total buts par équipe sur tout le match) —
  // marché standard émis par BetMomo/Apollo/Congobet. Manquait au comparateur foot.
  for (const [side, teamLbl] of [['home', 'Dom.'], ['away', 'Ext.']]) {
    for (const l of linesOf(oa, ob, new RegExp(`^tt_${side}_(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
      const ok = `tt_${side}_over_${l}`, uk = `tt_${side}_under_${l}`;
      const fam = `Total ${teamLbl} ${l}`;
      pushArb(out, fam, `${teamLbl} +${l}`, oa[ok], bookA, `${teamLbl} −${l}`, ob[uk], bookB);
      pushArb(out, fam, `${teamLbl} +${l}`, ob[ok], bookB, `${teamLbl} −${l}`, oa[uk], bookA);
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

const TENNIS_HCP_LINES = [-6.5, -5.5, -4.5, -3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5];
const SET_HCP_LINES = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5];

// Tennis : match winner 2-way, total jeux, handicap jeux/sets, total sets,
// per-set winner + totals, totaux joueur, pair/impair jeux.
export function compareTwoBooksTennis(rawA, bookA, rawB, bookB) {
  const oa = normalizeAliases(rawA);
  const ob = normalizeAliases(rawB);
  const out = [];
  pushArb(out, 'Match Winner', 'Joueur 1', oa.match_1, bookA, 'Joueur 2', ob.match_2, bookB);
  pushArb(out, 'Match Winner', 'Joueur 1', ob.match_1, bookB, 'Joueur 2', oa.match_2, bookA);
  for (const l of linesOf(oa, ob, /^match_(?:over|under)_(\d+(?:\.\d+)?)$/)) {
    const fam = `Total jeux ${l}`;
    pushArb(out, fam, `+${l}`, oa[`match_over_${l}`], bookA, `−${l}`, ob[`match_under_${l}`], bookB);
    pushArb(out, fam, `+${l}`, ob[`match_over_${l}`], bookB, `−${l}`, oa[`match_under_${l}`], bookA);
  }
  for (const l of TENNIS_HCP_LINES) {
    const hk = `hcp_home_${l}`, ak = `hcp_away_${-l}`;
    const fam = `Handicap jeux ${l > 0 ? '+' + l : l}`;
    pushArb(out, fam, `J1 ${l > 0 ? '+' + l : l}`, oa[hk], bookA, `J2 ${-l > 0 ? '+' + (-l) : -l}`, ob[ak], bookB);
    pushArb(out, fam, `J1 ${l > 0 ? '+' + l : l}`, ob[hk], bookB, `J2 ${-l > 0 ? '+' + (-l) : -l}`, oa[ak], bookA);
  }
  for (const l of SET_HCP_LINES) {
    const hk = `set_hcp_home_${l}`, ak = `set_hcp_away_${-l}`;
    const fam = `Handicap sets ${l > 0 ? '+' + l : l}`;
    pushArb(out, fam, `J1 ${l > 0 ? '+' + l : l}`, oa[hk], bookA, `J2 ${-l > 0 ? '+' + (-l) : -l}`, ob[ak], bookB);
    pushArb(out, fam, `J1 ${l > 0 ? '+' + l : l}`, ob[hk], bookB, `J2 ${-l > 0 ? '+' + (-l) : -l}`, oa[ak], bookA);
  }
  for (const l of linesOf(oa, ob, /^set_(?:over|under)_(\d+(?:\.\d+)?)$/)) {
    const fam = `Total sets ${l}`;
    pushArb(out, fam, `+${l}`, oa[`set_over_${l}`], bookA, `−${l}`, ob[`set_under_${l}`], bookB);
    pushArb(out, fam, `+${l}`, ob[`set_over_${l}`], bookB, `−${l}`, oa[`set_under_${l}`], bookA);
  }
  for (const [pfx, lbl] of [['s1_', 'Set 1'], ['s2_', 'Set 2'], ['s3_', 'Set 3']]) {
    pushArb(out, `${lbl} Winner`, 'J1', oa[`${pfx}match_1`], bookA, 'J2', ob[`${pfx}match_2`], bookB);
    pushArb(out, `${lbl} Winner`, 'J1', ob[`${pfx}match_1`], bookB, 'J2', oa[`${pfx}match_2`], bookA);
    for (const l of linesOf(oa, ob, new RegExp(`^${pfx}(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
      pushArb(out, `${lbl} Total ${l}`, `+${l}`, oa[`${pfx}over_${l}`], bookA, `−${l}`, ob[`${pfx}under_${l}`], bookB);
      pushArb(out, `${lbl} Total ${l}`, `+${l}`, ob[`${pfx}over_${l}`], bookB, `−${l}`, oa[`${pfx}under_${l}`], bookA);
    }
  }
  for (const [side, lbl] of [['home', 'J1'], ['away', 'J2']]) {
    for (const l of linesOf(oa, ob, new RegExp(`^tt_${side}_(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
      const ok = `tt_${side}_over_${l}`, uk = `tt_${side}_under_${l}`;
      pushArb(out, `Total ${lbl} ${l}`, `${lbl} +${l}`, oa[ok], bookA, `${lbl} −${l}`, ob[uk], bookB);
      pushArb(out, `Total ${lbl} ${l}`, `${lbl} +${l}`, ob[ok], bookB, `${lbl} −${l}`, oa[uk], bookA);
    }
  }
  pushArb(out, 'Pair/Impair jeux', 'Impair', oa.odd, bookA, 'Pair', ob.even, bookB);
  pushArb(out, 'Pair/Impair jeux', 'Impair', ob.odd, bookB, 'Pair', oa.even, bookA);
  return out;
}

const BASKET_HCP_LINES = [-12.5, -10.5, -8.5, -6.5, -4.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 4.5, 6.5, 8.5, 10.5, 12.5];
const HOCKEY_HCP_LINES = [-3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5];
const VOLLEY_HCP_LINES = [-5.5, -4.5, -3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5, 4.5, 5.5];

// Basketball : 2-way winner (regular time), total points, spread (handicap points),
// team totals, halves + quarters totals, pair/impair points.
export function compareTwoBooksBasket(rawA, bookA, rawB, bookB) {
  const oa = normalizeAliases(rawA);
  const ob = normalizeAliases(rawB);
  const out = [];
  pushArb(out, 'Match Winner', 'Équipe 1', oa.match_1, bookA, 'Équipe 2', ob.match_2, bookB);
  pushArb(out, 'Match Winner', 'Équipe 1', ob.match_1, bookB, 'Équipe 2', oa.match_2, bookA);
  for (const l of linesOf(oa, ob, /^match_(?:over|under)_(\d+(?:\.\d+)?)$/)) {
    pushArb(out, `Total points ${l}`, `+${l}`, oa[`match_over_${l}`], bookA, `−${l}`, ob[`match_under_${l}`], bookB);
    pushArb(out, `Total points ${l}`, `+${l}`, ob[`match_over_${l}`], bookB, `−${l}`, oa[`match_under_${l}`], bookA);
  }
  for (const l of BASKET_HCP_LINES) {
    const hk = `hcp_home_${l}`, ak = `hcp_away_${-l}`;
    const fam = `Handicap points ${l > 0 ? '+' + l : l}`;
    pushArb(out, fam, `Dom. ${l > 0 ? '+' + l : l}`, oa[hk], bookA, `Ext. ${-l > 0 ? '+' + (-l) : -l}`, ob[ak], bookB);
    pushArb(out, fam, `Dom. ${l > 0 ? '+' + l : l}`, ob[hk], bookB, `Ext. ${-l > 0 ? '+' + (-l) : -l}`, oa[ak], bookA);
  }
  for (const [side, lbl] of [['home', 'Dom.'], ['away', 'Ext.']]) {
    for (const l of linesOf(oa, ob, new RegExp(`^tt_${side}_(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
      pushArb(out, `Total ${lbl} ${l}`, `${lbl} +${l}`, oa[`tt_${side}_over_${l}`], bookA, `${lbl} −${l}`, ob[`tt_${side}_under_${l}`], bookB);
      pushArb(out, `Total ${lbl} ${l}`, `${lbl} +${l}`, ob[`tt_${side}_over_${l}`], bookB, `${lbl} −${l}`, oa[`tt_${side}_under_${l}`], bookA);
    }
  }
  // Halves + quarters totals + winners.
  for (const [pfx, lbl] of [['ht_', '1MT'], ['h2_', '2MT'], ['q1_', 'Q1'], ['q2_', 'Q2'], ['q3_', 'Q3'], ['q4_', 'Q4']]) {
    pushArb(out, `${lbl} Winner`, 'Dom.', oa[`${pfx}match_1`], bookA, 'Ext.', ob[`${pfx}match_2`], bookB);
    pushArb(out, `${lbl} Winner`, 'Dom.', ob[`${pfx}match_1`], bookB, 'Ext.', oa[`${pfx}match_2`], bookA);
    for (const l of linesOf(oa, ob, new RegExp(`^${pfx}(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
      pushArb(out, `${lbl} Total ${l}`, `+${l}`, oa[`${pfx}over_${l}`], bookA, `−${l}`, ob[`${pfx}under_${l}`], bookB);
      pushArb(out, `${lbl} Total ${l}`, `+${l}`, ob[`${pfx}over_${l}`], bookB, `−${l}`, oa[`${pfx}under_${l}`], bookA);
    }
  }
  pushArb(out, 'Pair/Impair points', 'Impair', oa.odd, bookA, 'Pair', ob.even, bookB);
  pushArb(out, 'Pair/Impair points', 'Impair', ob.odd, bookB, 'Pair', oa.even, bookA);
  return out;
}

// Ice Hockey : 3-way regular time (1X2), total goals, puck line (±1.5 handicap),
// team totals, period 1/2/3 markets, pair/impair goals.
export function compareTwoBooksHockey(rawA, bookA, rawB, bookB) {
  const oa = normalizeAliases(rawA);
  const ob = normalizeAliases(rawB);
  const out = [];
  // 1X2 regulation.
  const dcPairs = [
    ['match_1', 'dc_X2', '1X2 — 1 + X2', 'Domicile', 'Nul ou Ext.'],
    ['match_2', 'dc_1X', '1X2 — 2 + 1X', 'Extérieur', 'Dom. ou Nul'],
    ['match_X', 'dc_12', '1X2 — X + 12', 'Nul', 'Un gagnant'],
  ];
  for (const [sk, dk, fam, aL, bL] of dcPairs) {
    pushArb(out, fam, aL, oa[sk], bookA, bL, ob[dk], bookB);
    pushArb(out, fam, aL, ob[sk], bookB, bL, oa[dk], bookA);
  }
  // Draw No Bet (typique hockey en overtime).
  pushArb(out, 'Draw No Bet', 'Dom. (DNB)', oa.dnb_1, bookA, 'Ext. (DNB)', ob.dnb_2, bookB);
  pushArb(out, 'Draw No Bet', 'Dom. (DNB)', ob.dnb_1, bookB, 'Ext. (DNB)', oa.dnb_2, bookA);
  // Total goals.
  for (const l of linesOf(oa, ob, /^match_(?:over|under)_(\d+(?:\.\d+)?)$/)) {
    pushArb(out, `Total buts ${l}`, `+${l}`, oa[`match_over_${l}`], bookA, `−${l}`, ob[`match_under_${l}`], bookB);
    pushArb(out, `Total buts ${l}`, `+${l}`, ob[`match_over_${l}`], bookB, `−${l}`, oa[`match_under_${l}`], bookA);
  }
  // Puck line (handicap ±1.5 principalement).
  for (const l of HOCKEY_HCP_LINES) {
    const hk = `hcp_home_${l}`, ak = `hcp_away_${-l}`;
    const fam = `Puck Line ${l > 0 ? '+' + l : l}`;
    pushArb(out, fam, `Dom. ${l > 0 ? '+' + l : l}`, oa[hk], bookA, `Ext. ${-l > 0 ? '+' + (-l) : -l}`, ob[ak], bookB);
    pushArb(out, fam, `Dom. ${l > 0 ? '+' + l : l}`, ob[hk], bookB, `Ext. ${-l > 0 ? '+' + (-l) : -l}`, oa[ak], bookA);
  }
  // Team totals.
  for (const [side, lbl] of [['home', 'Dom.'], ['away', 'Ext.']]) {
    for (const l of linesOf(oa, ob, new RegExp(`^tt_${side}_(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
      pushArb(out, `Total ${lbl} ${l}`, `${lbl} +${l}`, oa[`tt_${side}_over_${l}`], bookA, `${lbl} −${l}`, ob[`tt_${side}_under_${l}`], bookB);
      pushArb(out, `Total ${lbl} ${l}`, `${lbl} +${l}`, ob[`tt_${side}_over_${l}`], bookB, `${lbl} −${l}`, oa[`tt_${side}_under_${l}`], bookA);
    }
  }
  // Périodes (p1, p2, p3).
  for (const [pfx, lbl] of [['p1_', 'P1'], ['p2_', 'P2'], ['p3_', 'P3']]) {
    for (const [sk, dk, aL, bL] of dcPairs) {
      pushArb(out, `${lbl} 1X2 — ${aL}`, aL, oa[`${pfx}${sk}`], bookA, bL, ob[`${pfx}${dk}`], bookB);
      pushArb(out, `${lbl} 1X2 — ${aL}`, aL, ob[`${pfx}${sk}`], bookB, bL, oa[`${pfx}${dk}`], bookA);
    }
    for (const l of linesOf(oa, ob, new RegExp(`^${pfx}(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
      pushArb(out, `${lbl} Total ${l}`, `+${l}`, oa[`${pfx}over_${l}`], bookA, `−${l}`, ob[`${pfx}under_${l}`], bookB);
      pushArb(out, `${lbl} Total ${l}`, `+${l}`, ob[`${pfx}over_${l}`], bookB, `−${l}`, oa[`${pfx}under_${l}`], bookA);
    }
  }
  // BTTS optionnel (rare mais existe).
  pushArb(out, 'BTTS', 'Oui', oa.btts_yes, bookA, 'Non', ob.btts_no, bookB);
  pushArb(out, 'BTTS', 'Oui', ob.btts_yes, bookB, 'Non', oa.btts_no, bookA);
  // Pair/Impair buts.
  pushArb(out, 'Pair/Impair buts', 'Impair', oa.odd, bookA, 'Pair', ob.even, bookB);
  pushArb(out, 'Pair/Impair buts', 'Impair', ob.odd, bookB, 'Pair', oa.even, bookA);
  return out;
}

// Volleyball : 2-way winner (best of 3/5 sets), total sets, handicap sets,
// per-set winner + total points par set, pair/impair points.
export function compareTwoBooksVolley(rawA, bookA, rawB, bookB) {
  const oa = normalizeAliases(rawA);
  const ob = normalizeAliases(rawB);
  const out = [];
  pushArb(out, 'Match Winner', 'Équipe 1', oa.match_1, bookA, 'Équipe 2', ob.match_2, bookB);
  pushArb(out, 'Match Winner', 'Équipe 1', ob.match_1, bookB, 'Équipe 2', oa.match_2, bookA);
  // Total sets (généralement 3.5 / 4.5).
  for (const l of linesOf(oa, ob, /^set_(?:over|under)_(\d+(?:\.\d+)?)$/)) {
    pushArb(out, `Total sets ${l}`, `+${l}`, oa[`set_over_${l}`], bookA, `−${l}`, ob[`set_under_${l}`], bookB);
    pushArb(out, `Total sets ${l}`, `+${l}`, ob[`set_over_${l}`], bookB, `−${l}`, oa[`set_under_${l}`], bookA);
  }
  // Total points match.
  for (const l of linesOf(oa, ob, /^match_(?:over|under)_(\d+(?:\.\d+)?)$/)) {
    pushArb(out, `Total points ${l}`, `+${l}`, oa[`match_over_${l}`], bookA, `−${l}`, ob[`match_under_${l}`], bookB);
    pushArb(out, `Total points ${l}`, `+${l}`, ob[`match_over_${l}`], bookB, `−${l}`, oa[`match_under_${l}`], bookA);
  }
  // Handicap sets (±0.5, ±1.5, ±2.5) et handicap points.
  for (const l of SET_HCP_LINES) {
    const hk = `set_hcp_home_${l}`, ak = `set_hcp_away_${-l}`;
    const fam = `Handicap sets ${l > 0 ? '+' + l : l}`;
    pushArb(out, fam, `Éq.1 ${l > 0 ? '+' + l : l}`, oa[hk], bookA, `Éq.2 ${-l > 0 ? '+' + (-l) : -l}`, ob[ak], bookB);
    pushArb(out, fam, `Éq.1 ${l > 0 ? '+' + l : l}`, ob[hk], bookB, `Éq.2 ${-l > 0 ? '+' + (-l) : -l}`, oa[ak], bookA);
  }
  for (const l of VOLLEY_HCP_LINES) {
    const hk = `hcp_home_${l}`, ak = `hcp_away_${-l}`;
    const fam = `Handicap points ${l > 0 ? '+' + l : l}`;
    pushArb(out, fam, `Éq.1 ${l > 0 ? '+' + l : l}`, oa[hk], bookA, `Éq.2 ${-l > 0 ? '+' + (-l) : -l}`, ob[ak], bookB);
    pushArb(out, fam, `Éq.1 ${l > 0 ? '+' + l : l}`, ob[hk], bookB, `Éq.2 ${-l > 0 ? '+' + (-l) : -l}`, oa[ak], bookA);
  }
  // Per-set winner + totals (up to 5 sets).
  for (const [pfx, lbl] of [['s1_', 'Set 1'], ['s2_', 'Set 2'], ['s3_', 'Set 3'], ['s4_', 'Set 4'], ['s5_', 'Set 5']]) {
    pushArb(out, `${lbl} Winner`, 'Éq.1', oa[`${pfx}match_1`], bookA, 'Éq.2', ob[`${pfx}match_2`], bookB);
    pushArb(out, `${lbl} Winner`, 'Éq.1', ob[`${pfx}match_1`], bookB, 'Éq.2', oa[`${pfx}match_2`], bookA);
    for (const l of linesOf(oa, ob, new RegExp(`^${pfx}(?:over|under)_(\\d+(?:\\.\\d+)?)$`))) {
      pushArb(out, `${lbl} Total ${l}`, `+${l}`, oa[`${pfx}over_${l}`], bookA, `−${l}`, ob[`${pfx}under_${l}`], bookB);
      pushArb(out, `${lbl} Total ${l}`, `+${l}`, ob[`${pfx}over_${l}`], bookB, `−${l}`, oa[`${pfx}under_${l}`], bookA);
    }
  }
  pushArb(out, 'Pair/Impair points', 'Impair', oa.odd, bookA, 'Pair', ob.even, bookB);
  pushArb(out, 'Pair/Impair points', 'Impair', ob.odd, bookB, 'Pair', oa.even, bookA);
  return out;
}

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
