// Parseur football Betika — mapping par sub_type_id (deterministe).
// Structure : data[].{ sub_type_id, name, odds[].{ display, odd_def, odd_value,
// special_bet_value, outcome_id } }. Les libelles sont traduits (fr) donc le
// mapping s'appuie sur sub_type_id + odd_def/display, jamais sur `name`.
//
// sub_type_id retenus (verifies sur Real Sociedad-Celta et Toulouse-Lille,
// 72 marches / 556 cotes) :
//    1 = 1X2                  10 = Double chance        11 = Draw No Bet
//   18 = Total buts           19 = Total dom.           20 = Total ext.
//   29 = BTTS                  8 = 1ere equipe a marquer (3 issues)
//   52 = Mi-temps la plus prolifique
//   60 = 1MT 1X2              63 = 1MT double chance    68 = 1MT total
//   69 = 1MT total dom.       70 = 1MT total ext.       75 = 1MT BTTS
//  166 = Total corners
//
// Volontairement NON mappes : 14 (handicap au score "0:1", pas un handicap
// asiatique → pas d'opposition garantie), 21/45/548 (scores/fourchettes exacts),
// 38/39/40 (buteurs), 139/152 (cartons, pas de vocabulaire commun).
import { isHalfLine } from '../../core/markets.js';

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 1.01 ? n : null;
};

const lineOf = (o) => {
  const m = /total=([\d.]+)/.exec(String(o?.special_bet_value || ''));
  return m ? m[1] : null;
};

// def = libelle non traduit cote Betika ("Plus de {total}", "{$competitor1}").
const def = (o) => String(o?.odd_def || '').toLowerCase();
const disp = (o) => String(o?.display || '').toUpperCase().trim();

function put(odds, key, v, m, o) {
  if (v == null || odds[key] != null) return;
  odds[key] = v;
  if (!odds._ids) odds._ids = {};
  odds._ids[key] = {
    match_id: null,
    sub_type_id: String(m?.sub_type_id ?? ''),
    outcome_id: o?.outcome_id != null ? String(o.outcome_id) : null,
    special_bet_value: o?.special_bet_value || null,
    market_name_native: String(m?.name ?? ''),
    selection_name_native: String(o?.display ?? ''),
    market_path_native: null,
  };
}

// Totaux Over/Under : demi-lignes uniquement.
function totals(odds, m, prefixOver, prefixUnder) {
  for (const o of m.odds || []) {
    const L = lineOf(o);
    if (!L || !isHalfLine(L)) continue;
    const v = num(o.odd_value);
    if (def(o).startsWith('plus de')) put(odds, `${prefixOver}${L}`, v, m, o);
    else if (def(o).startsWith('moins de')) put(odds, `${prefixUnder}${L}`, v, m, o);
  }
}

// 1X2 : display 1 / X / 2 (ou "MATCH NUL" sur certains marches).
function threeWay(odds, m, k1, kX, k2) {
  for (const o of m.odds || []) {
    const d = disp(o);
    const v = num(o.odd_value);
    if (d === '1') put(odds, k1, v, m, o);
    else if (d === 'X' || d === 'MATCH NUL') put(odds, kX, v, m, o);
    else if (d === '2') put(odds, k2, v, m, o);
  }
}

function doubleChance(odds, m, prefix) {
  for (const o of m.odds || []) {
    const d = disp(o).replace(/\s+/g, ' ');
    const v = num(o.odd_value);
    if (d === '1 OU X') put(odds, `${prefix}1X`, v, m, o);
    else if (d === '1 OU 2') put(odds, `${prefix}12`, v, m, o);
    else if (d === 'X OU 2') put(odds, `${prefix}X2`, v, m, o);
  }
}

function yesNo(odds, m, kYes, kNo) {
  for (const o of m.odds || []) {
    const d = def(o);
    const v = num(o.odd_value);
    if (d === 'oui') put(odds, kYes, v, m, o);
    else if (d === 'non') put(odds, kNo, v, m, o);
  }
}

export function betikaFlatOdds(markets, { sport = 'football' } = {}) {
  if (sport !== 'football') return {};
  const odds = {};
  for (const m of Array.isArray(markets) ? markets : []) {
    switch (String(m.sub_type_id)) {
      case '1': threeWay(odds, m, 'match_1', 'match_X', 'match_2'); break;
      case '10': doubleChance(odds, m, 'dc_'); break;
      case '11': {
        for (const o of m.odds || []) {
          const d = disp(o);
          if (d === '1') put(odds, 'dnb_1', num(o.odd_value), m, o);
          else if (d === '2') put(odds, 'dnb_2', num(o.odd_value), m, o);
        }
        break;
      }
      case '18': totals(odds, m, 'match_over_', 'match_under_'); break;
      case '19': totals(odds, m, 'tt_home_over_', 'tt_home_under_'); break;
      case '20': totals(odds, m, 'tt_away_over_', 'tt_away_under_'); break;
      case '29': yesNo(odds, m, 'btts_yes', 'btts_no'); break;
      case '8': {
        for (const o of m.odds || []) {
          const d = disp(o);
          const v = num(o.odd_value);
          if (d === '1') put(odds, 'fts_home', v, m, o);
          else if (d === '2') put(odds, 'fts_away', v, m, o);
          else if (d === 'AUCUN') put(odds, 'fts_none', v, m, o);
        }
        break;
      }
      case '52': {
        for (const o of m.odds || []) {
          const d = def(o);
          const v = num(o.odd_value);
          if (d === '1ere mi-temps') put(odds, 'half_most_ht', v, m, o);
          else if (d === '2eme mi-temps') put(odds, 'half_most_h2', v, m, o);
          else if (d === 'egal') put(odds, 'half_most_equal', v, m, o);
        }
        break;
      }
      case '60': threeWay(odds, m, 'ht_match_1', 'ht_match_X', 'ht_match_2'); break;
      case '63': doubleChance(odds, m, 'ht_dc_'); break;
      case '68': totals(odds, m, 'ht_over_', 'ht_under_'); break;
      case '69': totals(odds, m, 'ht_tt_home_over_', 'ht_tt_home_under_'); break;
      case '70': totals(odds, m, 'ht_tt_away_over_', 'ht_tt_away_under_'); break;
      case '75': yesNo(odds, m, 'ht_btts_yes', 'ht_btts_no'); break;
      case '166': totals(odds, m, 'cor_over_', 'cor_under_'); break;
      default: break;
    }
  }
  return odds;
}
