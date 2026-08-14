// Parseur football Apollo (BetTypeKey → clés plates standard).
// Chaque BetTypeKey correspond à un marché. On lit tous les offers avec
// cet BetTypeKey et on émet les clés d'odds standardisées.
import { isHalfLine } from '../../core/markets.js';

// eachOdd conserve son ancienne signature (t, name, c, sbv) pour compat.
function eachOdd(offers, key, cb) {
  for (const o of offers) {
    if (String(o.BetTypeKey) !== String(key)) continue;
    for (const od of o.Odds || []) {
      const c = parseFloat(od.Odd);
      if (!isNaN(c) && c > 1) cb(String(od.Type || ''), (od.Name || '').toString(), c, o.Sbv);
    }
  }
}

// eachOddL — variante qui passe aussi la Description de l'offer (pour libellé
// natif marché) et l'Odd complet (pour libellé natif sélection). Utilisée par
// les marchés enrichis pour dev report P2 (2026-08-14). Chaque callback reçoit :
//   (type, name, cote, sbv, description, oddObj)
function eachOddL(offers, key, cb) {
  for (const o of offers) {
    if (String(o.BetTypeKey) !== String(key)) continue;
    const desc = o.Description || o.Name || '';
    for (const od of o.Odds || []) {
      const c = parseFloat(od.Odd);
      if (!isNaN(c) && c > 1) cb(String(od.Type || ''), (od.Name || '').toString(), c, o.Sbv, desc, od);
    }
  }
}

// Helper : set odds[key] + _ids[key] avec libellés natifs Apollo. Apollo n'expose
// pas le chemin de navigation ("Football > Plus de paris > Clean Sheet") dans
// /match/offers — market_path_native reste null. Le SelectionId (od.Id) est
// stocké dans apolloOddId au cas ou Apollo exposera SaveCoupon un jour.
function putOdd(odds, key, cote, description, selectionName, oddId) {
  odds[key] = cote;
  odds._ids[key] = {
    market_name_native: description,
    selection_name_native: selectionName,
    market_path_native: null,
    ...(oddId != null ? { apolloOddId: String(oddId) } : {}),
  };
}

export function apolloFlatOdds(offers, { sport = 'football' } = {}) {
  if (sport === 'tennis') return apolloTennisFlatOdds(offers);
  // Volleyball Apollo : structure sets identique tennis (BetTypeKey 20 winner,
  // 502/558 s1/s2 winner, 910 hcp games, 911 total games/points, 914 total sets).
  // Reuse apolloTennisFlatOdds — les BetTypeKeys sont les memes en tennis/volley.
  if (sport === 'volleyball') return apolloTennisFlatOdds(offers);
  // Table Tennis Apollo : sid=417. Meme BetTypeKey=20 pour Winner 2-way.
  // Autres BetTypeKeys probablement partages avec tennis (handicap, total)
  // → reuse parseur tennis (2-way winner + hcp games/points + totals).
  if (sport === 'table_tennis') return apolloTennisFlatOdds(offers);
  // Basket Apollo — probe 2026-08-13 (32 matchs NBA) identifie 4 BetTypeKeys :
  //   key=1 (3m) samples "1:1 | X:X | 2:2" → 1X2 avec draw (règlementaire)
  //   key=20 (3m) samples "1:1 | 2:2" → Winner 2-way (incl OT)
  //   key=1003 (9m) samples "1:1 | 2:2" → probable handicap avec Sbv=line
  //   key=1004 (15m) samples "1:under | 2:over" → probable total points
  if (sport === 'basket') return apolloBasketFlatOdds(offers);
  // Hockey Apollo : sportId=398 identifie mais catalogue actuellement vide
  // (0 matchs 72h probe). BetTypeKeys non probes. Retour vide securite.
  if (sport === 'hockey') return {};
  const odds = { _ids: {} };
  if (!offers || !offers.length) return odds;
  // Shorthand : p(key, cote, description, selection_name, oddId).
  // Émet odds[key] + odds._ids[key] = { market_name_native, selection_name_native,
  // market_path_native, apolloOddId }. Extrait par extractNativeLabels (collect.js).
  const p = (key, c, d, n, id) => putOdd(odds, key, c, d, n, id);

  // ─── Fulltime ─────────────────────────────────────────────────────
  eachOddL(offers, 1, (t, n, c, _s, d, od) => { if (t === '1') p('match_1', c, d, n, od.Id); else if (t === 'X') p('match_X', c, d, n, od.Id); else if (t === '2') p('match_2', c, d, n, od.Id); });
  eachOddL(offers, 3, (t, n, c, _s, d, od) => { if (t === '1X') p('dc_1X', c, d, n, od.Id); else if (t === '12') p('dc_12', c, d, n, od.Id); else if (t === 'X2') p('dc_X2', c, d, n, od.Id); });
  eachOddL(offers, 4, (t, n, c, sbv, d, od) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; if (t === '1') p(`hcp_home_${l}`, c, d, n, od.Id); else if (t === '2') p(`hcp_away_${-l}`, c, d, n, od.Id); });
  eachOddL(offers, 43, (t, n, c, _s, d, od) => { if (t === '1') p('btts_yes', c, d, n, od.Id); else if (t === '2') p('btts_no', c, d, n, od.Id); });
  eachOddL(offers, 45, (_t, n, c, _s, d, od) => { const s = n.toLowerCase(); if (s.includes('odd') || s.includes('impair')) p('odd', c, d, n, od.Id); else if (s.includes('even') || s.includes('pair')) p('even', c, d, n, od.Id); });
  eachOddL(offers, 47, (t, n, c, _s, d, od) => { if (t === '1') p('dnb_1', c, d, n, od.Id); else if (t === '2') p('dnb_2', c, d, n, od.Id); });
  eachOddL(offers, 60, (_t, n, c, sbv, d, od) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) p(`match_under_${l}`, c, d, n, od.Id); else if (s.includes('over')) p(`match_over_${l}`, c, d, n, od.Id); });
  eachOddL(offers, 598, (_t, n, c, sbv, d, od) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) p(`tt_home_under_${l}`, c, d, n, od.Id); else if (s.includes('over')) p(`tt_home_over_${l}`, c, d, n, od.Id); });
  eachOddL(offers, 599, (_t, n, c, sbv, d, od) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) p(`tt_away_under_${l}`, c, d, n, od.Id); else if (s.includes('over')) p(`tt_away_over_${l}`, c, d, n, od.Id); });
  eachOddL(offers, 41, (t, n, c, _s, d, od) => { if (t === '1') p('fts_home', c, d, n, od.Id); else if (t === '2') p('fts_away', c, d, n, od.Id); else if (t === 'X') p('fts_none', c, d, n, od.Id); });
  eachOddL(offers, 531, (t, n, c, _s, d, od) => { if (t === '1') p('half_most_ht', c, d, n, od.Id); else if (t === '2') p('half_most_h2', c, d, n, od.Id); else if (t === 'X') p('half_most_equal', c, d, n, od.Id); });

  // ─── 1ère mi-temps ────────────────────────────────────────────────
  eachOddL(offers, 42, (t, n, c, _s, d, od) => {
    if (t === '1') p('ht_match_1', c, d, n, od.Id); else if (t === 'X') p('ht_match_X', c, d, n, od.Id); else if (t === '2') p('ht_match_2', c, d, n, od.Id);
    else if (t === '1X') p('ht_dc_1X', c, d, n, od.Id); else if (t === '12') p('ht_dc_12', c, d, n, od.Id); else if (t === 'X2') p('ht_dc_X2', c, d, n, od.Id);
  });
  eachOddL(offers, 200, (t, n, c, _s, d, od) => { if (t === '1') p('ht_dnb_1', c, d, n, od.Id); else if (t === '2') p('ht_dnb_2', c, d, n, od.Id); });
  eachOddL(offers, 606, (_t, n, c, _s, d, od) => { const s = n.toLowerCase(); if (s.includes('odd') || s.includes('impair')) p('ht_odd', c, d, n, od.Id); else if (s.includes('even') || s.includes('pair')) p('ht_even', c, d, n, od.Id); });
  eachOddL(offers, 5000, (_t, n, c, sbv, d, od) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) p(`ht_under_${l}`, c, d, n, od.Id); else if (s.includes('over')) p(`ht_over_${l}`, c, d, n, od.Id); });
  eachOddL(offers, 952, (t, n, c, _s, d, od) => { if (t === '1') p('ht_btts_yes', c, d, n, od.Id); else if (t === '2') p('ht_btts_no', c, d, n, od.Id); });
  eachOddL(offers, 4035, (t, n, c, sbv, d, od) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; if (t === '1') p(`ht_hcp_home_${l}`, c, d, n, od.Id); else if (t === '2') p(`ht_hcp_away_${-l}`, c, d, n, od.Id); });
  eachOddL(offers, 4037, (t, n, c, sbv, d, od) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; if (t === '1') p(`ht_tt_home_under_${l}`, c, d, n, od.Id); else if (t === '2') p(`ht_tt_home_over_${l}`, c, d, n, od.Id); });
  eachOddL(offers, 4038, (_t, n, c, sbv, d, od) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) p(`ht_tt_away_under_${l}`, c, d, n, od.Id); else if (s.includes('over')) p(`ht_tt_away_over_${l}`, c, d, n, od.Id); });

  // ─── 2ème mi-temps ────────────────────────────────────────────────
  eachOddL(offers, 546, (t, n, c, _s, d, od) => {
    if (t === '1') p('h2_match_1', c, d, n, od.Id); else if (t === 'X') p('h2_match_X', c, d, n, od.Id); else if (t === '2') p('h2_match_2', c, d, n, od.Id);
    else if (t === '1X') p('h2_dc_1X', c, d, n, od.Id); else if (t === '12') p('h2_dc_12', c, d, n, od.Id); else if (t === 'X2') p('h2_dc_X2', c, d, n, od.Id);
  });
  eachOddL(offers, 201, (t, n, c, _s, d, od) => { if (t === '1') p('h2_dnb_1', c, d, n, od.Id); else if (t === '2') p('h2_dnb_2', c, d, n, od.Id); });
  eachOddL(offers, 607, (_t, n, c, _s, d, od) => { const s = n.toLowerCase(); if (s.includes('odd') || s.includes('impair')) p('h2_odd', c, d, n, od.Id); else if (s.includes('even') || s.includes('pair')) p('h2_even', c, d, n, od.Id); });
  eachOddL(offers, 5001, (_t, n, c, sbv, d, od) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) p(`h2_under_${l}`, c, d, n, od.Id); else if (s.includes('over')) p(`h2_over_${l}`, c, d, n, od.Id); });
  eachOddL(offers, 953, (t, n, c, _s, d, od) => { if (t === '1') p('h2_btts_yes', c, d, n, od.Id); else if (t === '2') p('h2_btts_no', c, d, n, od.Id); });
  eachOddL(offers, 4036, (t, n, c, sbv, d, od) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; if (t === '1') p(`h2_hcp_home_${l}`, c, d, n, od.Id); else if (t === '2') p(`h2_hcp_away_${-l}`, c, d, n, od.Id); });
  eachOddL(offers, 4041, (_t, n, c, sbv, d, od) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) p(`h2_tt_home_under_${l}`, c, d, n, od.Id); else if (s.includes('over')) p(`h2_tt_home_over_${l}`, c, d, n, od.Id); });
  eachOddL(offers, 4042, (_t, n, c, sbv, d, od) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) p(`h2_tt_away_under_${l}`, c, d, n, od.Id); else if (s.includes('over')) p(`h2_tt_away_over_${l}`, c, d, n, od.Id); });

  // ─── Corners ──────────────────────────────────────────────────────
  eachOddL(offers, 127, (_t, n, c, sbv, d, od) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) p(`cor_under_${l}`, c, d, n, od.Id); else if (s.includes('over')) p(`cor_over_${l}`, c, d, n, od.Id); });
  eachOddL(offers, 128, (t, n, c, sbv, d, od) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; if (t === '1') p(`cor_hcp_home_${l}`, c, d, n, od.Id); else if (t === '2') p(`cor_hcp_away_${-l}`, c, d, n, od.Id); });
  eachOddL(offers, 129, (_t, n, c, _s, d, od) => { const s = n.toLowerCase(); if (s.includes('odd') || s.includes('impair')) p('cor_odd', c, d, n, od.Id); else if (s.includes('even') || s.includes('pair')) p('cor_even', c, d, n, od.Id); });
  eachOddL(offers, 5002, (_t, n, c, sbv, d, od) => { const l = parseFloat(sbv); if (!isHalfLine(l)) return; const s = n.toLowerCase(); if (s.includes('under')) p(`cor_ht_under_${l}`, c, d, n, od.Id); else if (s.includes('over')) p(`cor_ht_over_${l}`, c, d, n, od.Id); });

  // ─── Nouveaux marchés Apollo foot (audit 2026-08-13) ───────────────
  // Team Clean Sheet home/away (yes/no) - BetTypeKey 9980/9979
  // Audit 2026-08-14 : correction critique. Ancien mapping 901/902 était FAUX
  // (901 = "Home to win both halves", 902 = "Away to win both halves") → cotes
  // ~2x trop élevées → faux surebets sur Clean Sheet. Vrais keys via
  // Description="Clean Sheet Home Team"/"Clean Sheet Away Team", Type=1=Yes,
  // Type=2=No. Confirmé sur 2 matchs indépendants (SC Verl vs Duisburg,
  // Dresden vs Darmstadt) + 5 exemples user (Verl, Mjällby, Zenit, Neom,
  // Omonia — ratios envoyée/vraie 1.26 à 1.96, non constants).
  eachOddL(offers, 9980, (t, n, c, _s, d, od) => { if (t === '1') p('cs_home_yes', c, d, n, od.Id); else if (t === '2') p('cs_home_no', c, d, n, od.Id); });
  eachOddL(offers, 9979, (t, n, c, _s, d, od) => { if (t === '1') p('cs_away_yes', c, d, n, od.Id); else if (t === '2') p('cs_away_no', c, d, n, od.Id); });
  // 1st Half Clean Sheet home/away - BetTypeKey 958/959 (Description="1st Half
  // - Clean Sheet Home/Away Team", 1=yes, 2=no).
  eachOddL(offers, 958, (t, n, c, _s, d, od) => { if (t === '1') p('ht_cs_home_yes', c, d, n, od.Id); else if (t === '2') p('ht_cs_home_no', c, d, n, od.Id); });
  eachOddL(offers, 959, (t, n, c, _s, d, od) => { if (t === '1') p('ht_cs_away_yes', c, d, n, od.Id); else if (t === '2') p('ht_cs_away_no', c, d, n, od.Id); });
  // 2nd Half Clean Sheet home/away - BetTypeKey 960/961.
  eachOddL(offers, 960, (t, n, c, _s, d, od) => { if (t === '1') p('h2_cs_home_yes', c, d, n, od.Id); else if (t === '2') p('h2_cs_home_no', c, d, n, od.Id); });
  eachOddL(offers, 961, (t, n, c, _s, d, od) => { if (t === '1') p('h2_cs_away_yes', c, d, n, od.Id); else if (t === '2') p('h2_cs_away_no', c, d, n, od.Id); });
  // Team goals odd/even home/away - BetTypeKey 965/966
  // samples: 1:Even | 2:Odd (Type=1 = Even, Type=2 = Odd)
  eachOddL(offers, 965, (t, n, c, _s, d, od) => { if (t === '1') p('tt_home_even', c, d, n, od.Id); else if (t === '2') p('tt_home_odd', c, d, n, od.Id); });
  eachOddL(offers, 966, (t, n, c, _s, d, od) => { if (t === '1') p('tt_away_even', c, d, n, od.Id); else if (t === '2') p('tt_away_odd', c, d, n, od.Id); });

  return odds;
}

// ═══════════════════════════════════════════════════════════════
// PARSEUR BASKET Apollo (BetTypeKey → cle plate).
// Probe 2026-08-13 : NBA Detroit Pistons vs Boston Celtics + 31 autres.
// ═══════════════════════════════════════════════════════════════
function apolloBasketFlatOdds(offers) {
  const odds = {};
  if (!offers || !offers.length) return odds;
  // key=20 Winner 2-way (incl OT) — vrai winner basket cross-book
  eachOdd(offers, 20, (t, _n, c) => {
    if (t === '1') odds.match_1 = c;
    else if (t === '2') odds.match_2 = c;
  });
  // key=1004 Total Points (Sbv=line, tip 1=under, tip 2=over — pattern Apollo)
  eachOdd(offers, 1004, (t, _n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(l)) return;
    if (t === '1') odds[`match_under_${l}`] = c;
    else if (t === '2') odds[`match_over_${l}`] = c;
  });
  // key=1003 Handicap Points (Sbv=line, tip 1=home, tip 2=away avec inv sign)
  eachOdd(offers, 1003, (t, _n, c, sbv) => {
    const l = parseFloat(sbv);
    if (!isHalfLine(Math.abs(l))) return;
    if (t === '1') odds[`hcp_home_${l}`] = c;
    else if (t === '2') odds[`hcp_away_${-l}`] = c;
  });
  // key=1 reste ignoré (3-way avec draw = reglementaire, pas cross-book pour basket
  // vs 2-way incl OT qui est le vrai marché arbitrable)
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
  // ─── Nouveaux marchés Apollo tennis (audit 2026-08-13) ─────────────
  // key=211 Player 1 wins a set (Yes/No)
  eachOdd(offers, 211, (t, _n, c) => { if (t === '1') odds.tt_home_wins_a_set_yes = c; else if (t === '2') odds.tt_home_wins_a_set_no = c; });
  // key=212 Player 2 wins a set (Yes/No)
  eachOdd(offers, 212, (t, _n, c) => { if (t === '1') odds.tt_away_wins_a_set_yes = c; else if (t === '2') odds.tt_away_wins_a_set_no = c; });
  // key=852 "Will there be a 6-0 set?" (Yes/No)
  eachOdd(offers, 852, (t, _n, c) => { if (t === '1') odds.set_60_yes = c; else if (t === '2') odds.set_60_no = c; });

  return odds;
}
