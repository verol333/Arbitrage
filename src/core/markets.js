// Vocabulaire STANDARD des clés de cotes utilisé dans tout le système.
// Chaque bookmaker doit produire ses cotes plates sous ces mêmes clés — c'est ce
// qui permet à `arbitrage.js` d'être totalement agnostique du bookmaker.
//
// Format des clés :
//   Plein temps
//     match_1 / match_X / match_2                          → 1X2
//     dc_1X / dc_12 / dc_X2                                → Double Chance
//     btts_yes / btts_no                                   → BTTS
//     dnb_1 / dnb_2                                        → Draw No Bet (ou dnb_home/dnb_away)
//     match_over_<L> / match_under_<L>                     → Total buts (demi-lignes)
//     hcp_home_<L> / hcp_away_<L>                          → Handicap ±L
//     tt_home_over_<L> / tt_home_under_<L>                 → Total individuel dom.
//     tt_away_over_<L> / tt_away_under_<L>                 → Total individuel ext.
//     odd / even                                           → Pair/Impair
//     fts_home / fts_away / fts_none                       → 1ère équipe à marquer (3-way)
//     half_most_ht / half_most_h2 / half_most_equal        → Mi-temps la plus prolifique
//   Mi-temps (préfixes ht_ / h2_ ou sh_)
//     ht_match_1 / ht_dc_1X / ht_over_<L> / ht_hcp_home_<L> / ...
//     h2_match_1 / h2_dc_1X / h2_over_<L> / h2_hcp_home_<L> / ...
//   Corners (préfixe cor_ / cor_ht_)
//     cor_over_<L> / cor_under_<L>                         → Total corners
//     cor_hcp_home_<L> / cor_hcp_away_<L>                  → Handicap corners
//     cor_odd / cor_even                                   → Corners pair/impair
//     cor_ht_over_<L> / cor_ht_under_<L>                   → Corners 1MT total
//
// Notes :
//   - Certains bookmakers utilisent dnb_home/dnb_away au lieu de dnb_1/dnb_2 ; les
//     deux vocabulaires cohabitent — arbitrage.js accepte les deux.
//   - YellowBet evapi utilise sh_ pour la 2e mi-temps (pas h2_) — id.
//   - Les lignes sont TOUJOURS des demi-lignes (X.5) : les lignes entières/quarts
//     sont rejetées à la lecture (pas d'arbitrage garanti).

export function isHalfLine(n) {
  const v = Math.abs(Number(n));
  return Number.isFinite(v) && Math.abs((v * 2) % 2 - 1) < 1e-9;
}

// Normalise les alias vers le vocabulaire principal, sans détruire les clés déjà
// existantes. Appelé avant toute comparaison pour maximiser la couverture.
export function normalizeAliases(odds) {
  const o = { ...odds };
  const alias = (from, to) => { if (o[from] != null && o[to] == null) o[to] = o[from]; };
  alias('dnb_home', 'dnb_1');
  alias('dnb_away', 'dnb_2');
  alias('ht_dnb_home', 'ht_dnb_1');
  alias('ht_dnb_away', 'ht_dnb_2');
  alias('h2_dnb_home', 'h2_dnb_1');
  alias('h2_dnb_away', 'h2_dnb_2');
  // YellowBet : sh_ = 2e mi-temps (équivalent h2_).
  for (const k of Object.keys(o)) {
    if (k.startsWith('sh_')) alias(k, 'h2_' + k.slice(3));
    if (k.startsWith('ht_') && k !== 'ht_1' && k !== 'ht_X' && k !== 'ht_2') continue;
  }
  // YellowBet renvoie ht_1/ht_X/ht_2 et sh_1/sh_X/sh_2 — mappe vers ht_match_1 etc.
  alias('ht_1', 'ht_match_1'); alias('ht_X', 'ht_match_X'); alias('ht_2', 'ht_match_2');
  alias('sh_1', 'h2_match_1'); alias('sh_X', 'h2_match_X'); alias('sh_2', 'h2_match_2');
  // Pair/impair goals (YellowBet).
  alias('goals_odd', 'odd'); alias('goals_even', 'even');
  return o;
}
