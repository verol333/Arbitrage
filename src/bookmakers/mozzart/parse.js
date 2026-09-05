// Parseur football Mozzartbet — mapping deterministe par (gameId, subGameName).
// Les libelles sont en anglais et stables (lang:'en' force dans api.js).
//
// Groupes mappes (verifies le 05/09/2026 sur Hoffenheim-Dortmund, 422 cotes) :
//     1 Final Result          2 Double Chance        3 Total Goals U/O
//     4 First Half (1X2)    297 First Half DC        8 First Half Total
//     9 Second Half Total   19 Second Half (1X2)    26 Draw No Bet
//   139 First Half DNB      130 Both Teams to Score 16 Highest Scoring Half
//   131/132 Total par equipe        128/129 Total par equipe 1re MT
//   142/143 Total par equipe 2e MT   7 First to Score
//
// Volontairement NON mappes : 5 (MT/FT), 20 (score exact), 140/141/153/154/179/
// 180 (combines maison et handicaps "au moins 2 buts" sans equivalent ailleurs).
// Aucun marche a fourchette ("2-3", "no 1") n'est retenu : pas d'opposition
// garantie donc pas d'arbitrage possible.
import { isHalfLine } from '../../core/markets.js';

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 1.01 ? n : null;
};

function put(odds, key, v, o) {
  if (v == null || odds[key] != null) return;
  odds[key] = v;
  if (!odds._ids) odds._ids = {};
  odds._ids[key] = {
    match_id: o?.matchId != null ? String(o.matchId) : null,
    subgame_id: String(o?.subGame?.id ?? ''),
    odd_id: o?.id != null ? String(o.id) : null,
    special_odd_value: String(o?.specialOddValue ?? ''),
    market_name_native: String(o?.subGame?.gameName ?? ''),
    selection_name_native: String(o?.subGame?.subGameName ?? ''),
    market_path_native: null,
  };
}

/** "over 2.5" / "under 1.5" -> { side, line } ; tout le reste -> null. */
function overUnder(name) {
  const m = /^(over|under)\s+([\d.]+)$/.exec(name);
  if (!m || !isHalfLine(m[2])) return null;
  return { side: m[1], line: m[2] };
}

function totals(odds, o, name, prefixOver, prefixUnder) {
  const ou = overUnder(name);
  if (!ou) return;
  put(odds, (ou.side === 'over' ? prefixOver : prefixUnder) + ou.line, num(o.value), o);
}

/** Convertit les cotes brutes d'un match (kodds) en cotes plates standard. */
export function mozzartFlatOdds(kodds) {
  const odds = {};
  for (const o of Object.values(kodds || {})) {
    const sg = o?.subGame;
    if (!sg || o?.winStatus !== 'ACTIVE') continue;
    const g = String(sg.gameId);
    const n = String(sg.subGameName || '').trim().toLowerCase();
    const v = num(o.value);

    switch (g) {
      case '1':
        if (n === '1') put(odds, 'match_1', v, o);
        else if (n === 'x') put(odds, 'match_X', v, o);
        else if (n === '2') put(odds, 'match_2', v, o);
        break;
      case '2':
        if (n === '1x') put(odds, 'dc_1X', v, o);
        else if (n === '12') put(odds, 'dc_12', v, o);
        else if (n === 'x2') put(odds, 'dc_X2', v, o);
        break;
      case '3':
        if (n === 'even') put(odds, 'even', v, o);
        else if (n === 'odd') put(odds, 'odd', v, o);
        else totals(odds, o, n, 'match_over_', 'match_under_');
        break;
      case '4':
        if (n === '1') put(odds, 'ht_match_1', v, o);
        else if (n === 'x') put(odds, 'ht_match_X', v, o);
        else if (n === '2') put(odds, 'ht_match_2', v, o);
        break;
      case '297':
        if (n === '1x') put(odds, 'ht_dc_1X', v, o);
        else if (n === '12') put(odds, 'ht_dc_12', v, o);
        else if (n === 'x2') put(odds, 'ht_dc_X2', v, o);
        break;
      case '19':
        if (n === '1') put(odds, 'h2_match_1', v, o);
        else if (n === 'x') put(odds, 'h2_match_X', v, o);
        else if (n === '2') put(odds, 'h2_match_2', v, o);
        break;
      case '8': totals(odds, o, n, 'ht_over_', 'ht_under_'); break;
      case '9': totals(odds, o, n, 'h2_over_', 'h2_under_'); break;
      case '26':
        if (n === '1') put(odds, 'dnb_1', v, o);
        else if (n === '2') put(odds, 'dnb_2', v, o);
        break;
      case '139':
        if (n === '1') put(odds, 'ht_dnb_1', v, o);
        else if (n === '2') put(odds, 'ht_dnb_2', v, o);
        break;
      case '130':
        // gg = les deux marquent, ng = non. Les autres libelles de ce groupe
        // sont des combines (gg&ov 2.5, ggfh&ggsh...) : non opposables.
        if (n === 'gg') put(odds, 'btts_yes', v, o);
        else if (n === 'ng') put(odds, 'btts_no', v, o);
        break;
      case '16':
        if (n === '1') put(odds, 'half_most_ht', v, o);
        else if (n === '2') put(odds, 'half_most_h2', v, o);
        else if (n === 'x') put(odds, 'half_most_equal', v, o);
        break;
      case '131': totals(odds, o, n, 'tt_home_over_', 'tt_home_under_'); break;
      case '132': totals(odds, o, n, 'tt_away_over_', 'tt_away_under_'); break;
      case '128': totals(odds, o, n, 'ht_tt_home_over_', 'ht_tt_home_under_'); break;
      case '129': totals(odds, o, n, 'ht_tt_away_over_', 'ht_tt_away_under_'); break;
      case '142': totals(odds, o, n, 'h2_tt_home_over_', 'h2_tt_home_under_'); break;
      case '143': totals(odds, o, n, 'h2_tt_away_over_', 'h2_tt_away_under_'); break;
      case '7':
        if (n === 'team 1') put(odds, 'fts_home', v, o);
        else if (n === 'team 2') put(odds, 'fts_away', v, o);
        else if (n === 'no goals') put(odds, 'fts_none', v, o);
        break;
      default: break;
    }
  }
  return odds;
}
