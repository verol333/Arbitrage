// Parseur football Apollo (BetTypeKey → clés plates standard).
// Chaque BetTypeKey correspond à un marché. On lit tous les offers avec
// cet BetTypeKey et on émet les clés d'odds standardisées.
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

  // ─── Fulltime ─────────────────────────────────────────────────────
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

  // ─── 1ère mi-temps ────────────────────────────────────────────────
  eachOdd(offers, 42, (t, _n, c) => {
    if (t === '1') odds.ht_match_1 = c; else if (t === 'X') odds.ht_match_X = c; else if (t === '2') odds.ht_match_2 = c;
    else if (t === '1X') odds.ht_dc_1X = c; else if (t === '12') odds.ht_dc_12 = c; else if (t === 'X2') odds.ht_dc_X2 = c;
  });
  eachOdd(offers, 200, (t, _n, c) => { if (t === '1') odds.ht_dnb_1 = c; else if (t === '2') odds.ht_dnb_2 = c; });
  eachOdd(offers, 606, (_t, n, c) => { const s = n.toLowerCase(); if (s.includes('odd') || s.includes('impair')) odds.ht_odd = c; else if (s.includes('even') || s.includes('pair')) odds.ht_even = c; });
  eachOdd(offers, 5000, (_t, n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) odds[`ht_under_${l}`] = c; else if (s.includes('over')) odds[`ht_over_${l}`] = c; });
  eachOdd(offers, 952, (t, _n, c) => { if (t === '1') odds.ht_btts_yes = c; else if (t === '2') odds.ht_btts_no = c; });
  eachOdd(offers, 4035, (t, _n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; if (t === '1') odds[`ht_hcp_home_${l}`] = c; else if (t === '2') odds[`ht_hcp_away_${-l}`] = c; });
  eachOdd(offers, 4037, (t, _n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; if (t === '1') odds[`ht_tt_home_under_${l}`] = c; else if (t === '2') odds[`ht_tt_home_over_${l}`] = c; });
  eachOdd(offers, 4038, (_t, n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) odds[`ht_tt_away_under_${l}`] = c; else if (s.includes('over')) odds[`ht_tt_away_over_${l}`] = c; });

  // ─── 2ème mi-temps ────────────────────────────────────────────────
  eachOdd(offers, 546, (t, _n, c) => {
    if (t === '1') odds.h2_match_1 = c; else if (t === 'X') odds.h2_match_X = c; else if (t === '2') odds.h2_match_2 = c;
    else if (t === '1X') odds.h2_dc_1X = c; else if (t === '12') odds.h2_dc_12 = c; else if (t === 'X2') odds.h2_dc_X2 = c;
  });
  eachOdd(offers, 201, (t, _n, c) => { if (t === '1') odds.h2_dnb_1 = c; else if (t === '2') odds.h2_dnb_2 = c; });
  eachOdd(offers, 607, (_t, n, c) => { const s = n.toLowerCase(); if (s.includes('odd') || s.includes('impair')) odds.h2_odd = c; else if (s.includes('even') || s.includes('pair')) odds.h2_even = c; });
  eachOdd(offers, 5001, (_t, n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) odds[`h2_under_${l}`] = c; else if (s.includes('over')) odds[`h2_over_${l}`] = c; });
  eachOdd(offers, 953, (t, _n, c) => { if (t === '1') odds.h2_btts_yes = c; else if (t === '2') odds.h2_btts_no = c; });
  eachOdd(offers, 4036, (t, _n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; if (t === '1') odds[`h2_hcp_home_${l}`] = c; else if (t === '2') odds[`h2_hcp_away_${-l}`] = c; });
  eachOdd(offers, 4041, (_t, n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) odds[`h2_tt_home_under_${l}`] = c; else if (s.includes('over')) odds[`h2_tt_home_over_${l}`] = c; });
  eachOdd(offers, 4042, (_t, n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) odds[`h2_tt_away_under_${l}`] = c; else if (s.includes('over')) odds[`h2_tt_away_over_${l}`] = c; });

  // ─── Corners ──────────────────────────────────────────────────────
  eachOdd(offers, 127, (_t, n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) odds[`cor_under_${l}`] = c; else if (s.includes('over')) odds[`cor_over_${l}`] = c; });
  eachOdd(offers, 128, (t, _n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; if (t === '1') odds[`cor_hcp_home_${l}`] = c; else if (t === '2') odds[`cor_hcp_away_${-l}`] = c; });
  eachOdd(offers, 129, (_t, n, c) => { const s = n.toLowerCase(); if (s.includes('odd') || s.includes('impair')) odds.cor_odd = c; else if (s.includes('even') || s.includes('pair')) odds.cor_even = c; });
  eachOdd(offers, 5002, (_t, n, c, sbv) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) odds[`cor_ht_under_${l}`] = c; else if (s.includes('over')) odds[`cor_ht_over_${l}`] = c; });

  return odds;
}
