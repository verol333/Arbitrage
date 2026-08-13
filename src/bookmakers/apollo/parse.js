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

export function apolloFlatOdds(offers, { sport = 'football' } = {}) {
  if (sport === 'tennis') return apolloTennisFlatOdds(offers);
  // Volleyball Apollo : structure sets identique tennis (BetTypeKey 20 winner,
  // 502/558 s1/s2 winner, 910 hcp games, 911 total games/points, 914 total sets).
  // Reuse apolloTennisFlatOdds — les BetTypeKeys sont les memes en tennis/volley.
  if (sport === 'volleyball') return apolloTennisFlatOdds(offers);
  // Basket : BetTypeKey basket Apollo non probes en prod. Sans mapping valide,
  // retourner odds vides plutot que mismapper des keys foot/tennis sur du basket
  // (produirait des fake arbs). A activer apres probe basket depuis GH Actions.
  if (sport === 'basket') return {};
  // Hockey Apollo : sportId=398 identifie mais catalogue actuellement vide
  // (0 matchs 72h probe). BetTypeKeys non probes. Retour vide securite.
  if (sport === 'hockey') return {};
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

  // ─── Nouveaux marchés Apollo foot (audit 2026-08-13) ───────────────
  // Team Clean Sheet home/away (yes/no) - BetTypeKey 901/902
  // samples: 1:yes | 2:no (Type=1 = Yes, Type=2 = No)
  eachOdd(offers, 901, (t, _n, c) => { if (t === '1') odds.cs_home_yes = c; else if (t === '2') odds.cs_home_no = c; });
  eachOdd(offers, 902, (t, _n, c) => { if (t === '1') odds.cs_away_yes = c; else if (t === '2') odds.cs_away_no = c; });
  // Team goals odd/even home/away - BetTypeKey 965/966
  // samples: 1:Even | 2:Odd (Type=1 = Even, Type=2 = Odd)
  eachOdd(offers, 965, (t, _n, c) => { if (t === '1') odds.tt_home_even = c; else if (t === '2') odds.tt_home_odd = c; });
  eachOdd(offers, 966, (t, _n, c) => { if (t === '1') odds.tt_away_even = c; else if (t === '2') odds.tt_away_odd = c; });

  return odds;
}

// ═══════════════════════════════════════════════════════════════
// PARSEUR TENNIS Apollo (BetTypeKey → cle plate).
// Verifie via IncludeBetTypeNames=true, 11 marches utiles cross-book.
// ATTENTION : 911/841/842/597 utilisent "tip 1 = under, tip 2 = over"
// (documente dans BetTypeInfo API) → t=1 mappe Under, t=2 mappe Over.
// ═══════════════════════════════════════════════════════════════
function apolloTennisFlatOdds(offers) {
  const odds = {};
  if (!offers || !offers.length) return odds;

  // Match Winner (2-way tennis) — BetTypeKey=20, "Two-Way Basic Offer"
  eachOdd(offers, 20, (t, _n, c) => {
    if (t === '1') odds.match_1 = c;
    else if (t === '2') odds.match_2 = c;
  });
  // 1st Set Winner — BetTypeKey=502, "1. set"
  eachOdd(offers, 502, (t, _n, c) => {
    if (t === '1') odds.s1_match_1 = c;
    else if (t === '2') odds.s1_match_2 = c;
  });
  // 2nd Set Winner — BetTypeKey=558, "2. set"
  eachOdd(offers, 558, (t, _n, c) => {
    if (t === '1') odds.s2_match_1 = c;
    else if (t === '2') odds.s2_match_2 = c;
  });
  // Game Handicap — BetTypeKey=910, "Handicap games", Sbv=line
  eachOdd(offers, 910, (t, _n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(Math.abs(l))) return;
    if (t === '1') odds[`hcp_home_${l}`] = c;
    else if (t === '2') odds[`hcp_away_${-l}`] = c;
  });
  // Total Games Match — BetTypeKey=911, "Total games". "tip 1=under, tip 2=over".
  eachOdd(offers, 911, (t, _n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(l)) return;
    if (t === '1') odds[`match_under_${l}`] = c;
    else if (t === '2') odds[`match_over_${l}`] = c;
  });
  // Home Total Games — BetTypeKey=841. "tip 1=under, tip 2=over"
  eachOdd(offers, 841, (t, _n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(l)) return;
    if (t === '1') odds[`tt_home_under_${l}`] = c;
    else if (t === '2') odds[`tt_home_over_${l}`] = c;
  });
  // Away Total Games — BetTypeKey=842. "tip 1=under, tip 2=over"
  eachOdd(offers, 842, (t, _n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(l)) return;
    if (t === '1') odds[`tt_away_under_${l}`] = c;
    else if (t === '2') odds[`tt_away_over_${l}`] = c;
  });
  // 1st Set Total Games — BetTypeKey=597, "1st Set - Total Games". "tip 1=under, tip 2=over"
  eachOdd(offers, 597, (t, _n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(l)) return;
    if (t === '1') odds[`s1_under_${l}`] = c;
    else if (t === '2') odds[`s1_over_${l}`] = c;
  });
  // 1st Set Game Handicap — BetTypeKey=988
  eachOdd(offers, 988, (t, _n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(Math.abs(l))) return;
    if (t === '1') odds[`s1_hcp_home_${l}`] = c;
    else if (t === '2') odds[`s1_hcp_away_${-l}`] = c;
  });
  // Set Handicap (±1.5) — BetTypeKey=914, "Handicap sets"
  eachOdd(offers, 914, (t, _n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(Math.abs(l))) return;
    if (t === '1') odds[`hcp_sets_home_${l}`] = c;
    else if (t === '2') odds[`hcp_sets_away_${-l}`] = c;
  });
  // Total Sets (2 or 3) — BetTypeKey=915, "Total Number of Sets"
  eachOdd(offers, 915, (t, _n, c) => {
    if (t === '2') odds.total_sets_2 = c;
    else if (t === '3') odds.total_sets_3 = c;
  });

  return odds;
}
