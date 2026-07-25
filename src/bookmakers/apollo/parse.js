// Parseur football Apollo (BetTypeKey → clés plates standard).
// Port fidèle de apolloClient.ts apolloFlatOdds().
import { isHalfLine } from '../../core/markets.js';

function eachOdd(offers, key, cb) {
  for (const o of offers) {
    if (String(o.BetTypeKey) !== String(key)) continue;
    for (const od of o.Odds || []) {
      const c = parseFloat(od.Odd);
      if (!isNaN(c) && c > 1) cb(String(od.Type || ''), (od.Name || '').toString(), c, o.Sbv);
    }
  }
}

export function apolloFlatOdds(offers) {
  const odds = {};
  if (!offers || !offers.length) return odds;

  eachOdd(offers, 1, (t, _n, c) => { if (t === '1') odds.match_1 = c; else if (t === 'X') odds.match_X = c; else if (t === '2') odds.match_2 = c; });
  eachOdd(offers, 3, (t, _n, c) => { if (t === '1X') odds.dc_1X = c; else if (t === '12') odds.dc_12 = c; else if (t === 'X2') odds.dc_X2 = c; });
  eachOdd(offers, 4, (t, _n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; if (t === '1') odds[`hcp_home_${l}`] = c; else if (t === '2') odds[`hcp_away_${-l}`] = c; });
  eachOdd(offers, 43, (t, _n, c) => { if (t === '1') odds.btts_yes = c; else if (t === '2') odds.btts_no = c; });
  eachOdd(offers, 45, (_t, n, c) => { const s = n.toLowerCase(); if (s.includes('odd') || s.includes('impair')) odds.odd = c; else if (s.includes('even') || s.includes('pair')) odds.even = c; });
  eachOdd(offers, 47, (t, _n, c) => { if (t === '1') odds.dnb_1 = c; else if (t === '2') odds.dnb_2 = c; });
  eachOdd(offers, 60, (_t, n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) odds[`match_under_${l}`] = c; else if (s.includes('over')) odds[`match_over_${l}`] = c; });
  eachOdd(offers, 598, (_t, n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) odds[`tt_home_under_${l}`] = c; else if (s.includes('over')) odds[`tt_home_over_${l}`] = c; });
  eachOdd(offers, 599, (_t, n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) odds[`tt_away_under_${l}`] = c; else if (s.includes('over')) odds[`tt_away_over_${l}`] = c; });
  eachOdd(offers, 41, (t, _n, c) => { if (t === '1') odds.fts_home = c; else if (t === '2') odds.fts_away = c; else if (t === 'X') odds.fts_none = c; });
  eachOdd(offers, 531, (t, _n, c) => { if (t === '1') odds.half_most_ht = c; else if (t === '2') odds.half_most_h2 = c; else if (t === 'X') odds.half_most_equal = c; });
  eachOdd(offers, 42, (t, _n, c) => {
    if (t === '1') odds.ht_match_1 = c; else if (t === 'X') odds.ht_match_X = c; else if (t === '2') odds.ht_match_2 = c;
    else if (t === '1X') odds.ht_dc_1X = c; else if (t === '12') odds.ht_dc_12 = c; else if (t === 'X2') odds.ht_dc_X2 = c;
  });
  eachOdd(offers, 200, (t, _n, c) => { if (t === '1') odds.ht_dnb_1 = c; else if (t === '2') odds.ht_dnb_2 = c; });
  eachOdd(offers, 201, (t, _n, c) => { if (t === '1') odds.h2_dnb_1 = c; else if (t === '2') odds.h2_dnb_2 = c; });
  eachOdd(offers, 606, (_t, n, c) => { const s = n.toLowerCase(); if (s.includes('odd') || s.includes('impair')) odds.ht_odd = c; else if (s.includes('even') || s.includes('pair')) odds.ht_even = c; });
  eachOdd(offers, 607, (_t, n, c) => { const s = n.toLowerCase(); if (s.includes('odd') || s.includes('impair')) odds.h2_odd = c; else if (s.includes('even') || s.includes('pair')) odds.h2_even = c; });
  eachOdd(offers, 5000, (_t, n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) odds[`ht_under_${l}`] = c; else if (s.includes('over')) odds[`ht_over_${l}`] = c; });
  eachOdd(offers, 5001, (_t, n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) odds[`h2_under_${l}`] = c; else if (s.includes('over')) odds[`h2_over_${l}`] = c; });
  eachOdd(offers, 952, (t, _n, c) => { if (t === '1') odds.ht_btts_yes = c; else if (t === '2') odds.ht_btts_no = c; });
  eachOdd(offers, 953, (t, _n, c) => { if (t === '1') odds.h2_btts_yes = c; else if (t === '2') odds.h2_btts_no = c; });
  eachOdd(offers, 4035, (t, _n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; if (t === '1') odds[`ht_hcp_home_${l}`] = c; else if (t === '2') odds[`ht_hcp_away_${-l}`] = c; });
  eachOdd(offers, 4036, (t, _n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; if (t === '1') odds[`h2_hcp_home_${l}`] = c; else if (t === '2') odds[`h2_hcp_away_${-l}`] = c; });
  eachOdd(offers, 4037, (t, _n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; if (t === '1') odds[`ht_tt_home_under_${l}`] = c; else if (t === '2') odds[`ht_tt_home_over_${l}`] = c; });
  eachOdd(offers, 4041, (_t, n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) odds[`h2_tt_home_under_${l}`] = c; else if (s.includes('over')) odds[`h2_tt_home_over_${l}`] = c; });
  eachOdd(offers, 4042, (_t, n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) odds[`h2_tt_away_under_${l}`] = c; else if (s.includes('over')) odds[`h2_tt_away_over_${l}`] = c; });
  // HT individual totals away.
  eachOdd(offers, 4038, (_t, n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) odds[`ht_tt_away_under_${l}`] = c; else if (s.includes('over')) odds[`ht_tt_away_over_${l}`] = c; });
  // Corners total.
  eachOdd(offers, 127, (_t, n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) odds[`cor_under_${l}`] = c; else if (s.includes('over')) odds[`cor_over_${l}`] = c; });
  // Corners handicap.
  eachOdd(offers, 128, (t, _n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; if (t === '1') odds[`cor_hcp_home_${l}`] = c; else if (t === '2') odds[`cor_hcp_away_${-l}`] = c; });
  // Corners odd/even.
  eachOdd(offers, 129, (_t, n, c) => { const s = n.toLowerCase(); if (s.includes('odd') || s.includes('impair')) odds.cor_odd = c; else if (s.includes('even') || s.includes('pair')) odds.cor_even = c; });
  // HT corners total.
  eachOdd(offers, 5002, (_t, n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) odds[`cor_ht_under_${l}`] = c; else if (s.includes('over')) odds[`cor_ht_over_${l}`] = c; });
  // 2nd half 1X2 and DC.
  eachOdd(offers, 546, (t, _n, c) => {
    if (t === '1') odds.h2_match_1 = c; else if (t === 'X') odds.h2_match_X = c; else if (t === '2') odds.h2_match_2 = c;
    else if (t === '1X') odds.h2_dc_1X = c; else if (t === '12') odds.h2_dc_12 = c; else if (t === 'X2') odds.h2_dc_X2 = c;
  });
  // ─── TENNIS Apollo (BetTypeKey découverts via probe) ─────────────────────
  // 20 : Match Winner 2-way (Type='1'/'2').
  eachOdd(offers, 20, (t, _n, c) => {
    if (t === '1') odds.match_1 = c;
    else if (t === '2') odds.match_2 = c;
  });
  // 911 : Total Games (Sbv = seuil, Name = 'Under'/'Over').
  eachOdd(offers, 911, (_t, n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(l)) return;
    const s = String(n).toLowerCase();
    if (s.includes('under')) odds[`match_under_${l}`] = c;
    else if (s.includes('over')) odds[`match_over_${l}`] = c;
  });
  // 910 : Games Handicap (Type '1'/'2', Sbv seuil).
  eachOdd(offers, 910, (t, _n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(l)) return;
    if (t === '1') odds[`hcp_home_${l}`] = c;
    else if (t === '2') odds[`hcp_away_${-l}`] = c;
  });
  // 914 : Sets Handicap (Sbv ±1.5, Type '1'/'2').
  eachOdd(offers, 914, (t, _n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(l)) return;
    if (t === '1') odds[`set_hcp_home_${l}`] = c;
    else if (t === '2') odds[`set_hcp_away_${-l}`] = c;
  });
  // 915 : Total Sets Over/Under (Type '2' Under, Type '3' Over typiquement).
  eachOdd(offers, 915, (_t, n, c, sbv) => {
    const l = parseFloat(sbv || '2.5');
    if (!isHalfLine(l)) return;
    const s = String(n).toLowerCase();
    if (s.includes('under') || n === '2') odds[`set_under_${l}`] = c;
    else if (s.includes('over') || n === '3') odds[`set_over_${l}`] = c;
  });
  // 597 : 1st Set TOTAL GAMES (Sbv 6.5-12.5, pas "Player Total"). Corrigé.
  eachOdd(offers, 597, (_t, n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(l)) return;
    const s = String(n).toLowerCase();
    if (s.includes('under')) odds[`s1_under_${l}`] = c;
    else if (s.includes('over')) odds[`s1_over_${l}`] = c;
  });
  // 841 : Player 1 Total Games (Sbv 11.5-14.5, plage cohérente avec un joueur).
  eachOdd(offers, 841, (_t, n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(l)) return;
    const s = String(n).toLowerCase();
    if (s.includes('under')) odds[`tt_home_under_${l}`] = c;
    else if (s.includes('over')) odds[`tt_home_over_${l}`] = c;
  });
  // 842 : Player 2 Total Games (Sbv 10.5-13.5).
  eachOdd(offers, 842, (_t, n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(l)) return;
    const s = String(n).toLowerCase();
    if (s.includes('under')) odds[`tt_away_under_${l}`] = c;
    else if (s.includes('over')) odds[`tt_away_over_${l}`] = c;
  });
  // ─── BASKETBALL Apollo (BetTypeKey via probe basket) ──────────────────────
  // 1003 : Handicap Points (incl. OT) — Type 1/2, Sbv = ligne signée.
  eachOdd(offers, 1003, (t, _n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(l)) return;
    if (t === '1') odds[`hcp_home_${l}`] = c;
    else if (t === '2') odds[`hcp_away_${-l}`] = c;
  });
  // 1004 : Total Points (incl. OT) — Name = under/over, Sbv = seuil.
  eachOdd(offers, 1004, (_t, n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(l)) return;
    const s = String(n).toLowerCase();
    if (s.includes('under')) odds[`match_under_${l}`] = c;
    else if (s.includes('over')) odds[`match_over_${l}`] = c;
  });
  // 560 : Total Points team 1 (incl. OT).
  eachOdd(offers, 560, (_t, n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(l)) return;
    const s = String(n).toLowerCase();
    if (s.includes('under')) odds[`tt_home_under_${l}`] = c;
    else if (s.includes('over')) odds[`tt_home_over_${l}`] = c;
  });
  // 561 : Total Points team 2 (incl. OT).
  eachOdd(offers, 561, (_t, n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(l)) return;
    const s = String(n).toLowerCase();
    if (s.includes('under')) odds[`tt_away_under_${l}`] = c;
    else if (s.includes('over')) odds[`tt_away_over_${l}`] = c;
  });
  // 1002 : Even/Odd Points (incl. OT).
  eachOdd(offers, 1002, (_t, n, c) => {
    const s = String(n).toLowerCase();
    if (s.includes('odd') || s.includes('impair')) odds.odd = c;
    else if (s.includes('even') || s.includes('pair')) odds.even = c;
  });
  // 504 : 2nd halftime 1X2.
  eachOdd(offers, 504, (t, _n, c) => {
    if (t === '1') odds.h2_match_1 = c;
    else if (t === 'X') odds.h2_match_X = c;
    else if (t === '2') odds.h2_match_2 = c;
  });
  // 562 : Total Points 1st Half (basket).
  eachOdd(offers, 562, (_t, n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(l)) return;
    const s = String(n).toLowerCase();
    if (s.includes('under')) odds[`ht_under_${l}`] = c;
    else if (s.includes('over')) odds[`ht_over_${l}`] = c;
  });
  // 620 : Handicap Points 1st Half.
  eachOdd(offers, 620, (t, _n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(l)) return;
    if (t === '1') odds[`ht_hcp_home_${l}`] = c;
    else if (t === '2') odds[`ht_hcp_away_${-l}`] = c;
  });
  // 1006 : Handicap Points 2nd Half.
  eachOdd(offers, 1006, (t, _n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(l)) return;
    if (t === '1') odds[`h2_hcp_home_${l}`] = c;
    else if (t === '2') odds[`h2_hcp_away_${-l}`] = c;
  });
  // ─── VOLLEYBALL Apollo (BetTypeKey via probe volley) ──────────────────────
  // 2 : Winner 2-way (alias, redondant avec 20).
  eachOdd(offers, 2, (t, _n, c) => {
    if (t === '1' && odds.match_1 == null) odds.match_1 = c;
    else if (t === '2' && odds.match_2 == null) odds.match_2 = c;
  });
  // 519 : Handicap Points volley (Sbv signé, Type 1/2).
  eachOdd(offers, 519, (t, _n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(l)) return;
    if (t === '1') odds[`hcp_home_${l}`] = c;
    else if (t === '2') odds[`hcp_away_${-l}`] = c;
  });
  // 552 : Total Points volley.
  eachOdd(offers, 552, (_t, n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(l)) return;
    const s = String(n).toLowerCase();
    if (s.includes('under')) odds[`match_under_${l}`] = c;
    else if (s.includes('over')) odds[`match_over_${l}`] = c;
  });
  // 916 IGNORÉ : Total Number of Sets = nb EXACT (3/4/5), pas un over/under.
  // Le convertir en set_over/under_3.5 créait des cotes agrégées non
  // comparables avec les autres books qui exposent un vrai over/under sets.
  // 502 / 558 / 563 : Set 1/2/3 Winner.
  for (const [key, pfx] of [[502, 's1_'], [558, 's2_'], [563, 's3_']]) {
    eachOdd(offers, key, (t, _n, c) => {
      if (t === '1') odds[`${pfx}match_1`] = c;
      else if (t === '2') odds[`${pfx}match_2`] = c;
    });
  }
  // 989 : 1st Set Handicap Points.
  eachOdd(offers, 989, (t, _n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(l)) return;
    if (t === '1') odds[`s1_hcp_home_${l}`] = c;
    else if (t === '2') odds[`s1_hcp_away_${-l}`] = c;
  });
  // 990 : 1st Set Total Points.
  eachOdd(offers, 990, (_t, n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(l)) return;
    const s = String(n).toLowerCase();
    if (s.includes('under')) odds[`s1_under_${l}`] = c;
    else if (s.includes('over')) odds[`s1_over_${l}`] = c;
  });
  // 559 : Even/Odd Points volley.
  eachOdd(offers, 559, (_t, n, c) => {
    const s = String(n).toLowerCase();
    if (s.includes('odd') || s.includes('impair')) odds.odd = odds.odd || c;
    else if (s.includes('even') || s.includes('pair')) odds.even = odds.even || c;
  });
  return odds;
}
