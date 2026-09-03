// Parseur TENNIS Betika - mapping par sub_type_id (deterministe).
// Verifie le 2026-09-03 sur 3 affiches reelles (US Open Simple Dames x2 +
// ATP Challenger) : 20 marches exposes par affiche, 10 sub_type_id retenus.
//
// Regles de surete identiques aux autres books :
//   1) WHITELIST de sub_type_id (les libelles sont traduits en fr, jamais lus
//      pour decider - on lit sub_type_id + odd_def + special_bet_value) ;
//   2) DEMI-LIGNES uniquement (une ligne entiere = remboursement possible,
//      donc aucun arbitrage garanti) ;
//   3) le numero de set vient de special_bet_value (setnr=N), jamais du libelle.
//
// sub_type_id retenus :
//   186 = vainqueur du match          187 = handicap jeux
//   188 = handicap sets               189 = total jeux du match
//   190 = total jeux joueur 1         191 = total jeux joueur 2
//   192 = J1 gagne un set             193 = J2 gagne un set
//   196 = nombre exact de sets (best-of-3 seulement)
//   202 = vainqueur du set N          203 = handicap jeux du set N
//   204 = total jeux du set N
//
// Volontairement NON mappes : 194 (set a zero), 199/207 (scores exacts),
// 201 (double resultat), 1055 (vainqueur + total) - aucun vocabulaire commun
// avec les autres books, donc aucune paire opposable fiable.
import { isHalfLine } from '../../core/markets.js';

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 1.01 ? n : null;
};

// def = libelle NON traduit ("Plus de {total}", "{$competitor1} ({+hcp})").
const def = (o) => String(o?.odd_def || '').toLowerCase();
const disp = (o) => String(o?.display || '').toUpperCase().trim();
const sbv = (o) => String(o?.special_bet_value || '');

const totalOf = (o) => {
  const m = /total=(\d+(?:\.\d+)?)/.exec(sbv(o));
  return m ? m[1] : null;
};

// Numero de set : "setnr=1|hcp=2.5" -> 1. Aucun set = null.
const setNrOf = (o) => {
  const m = /setnr=(\d)/.exec(sbv(o));
  return m ? m[1] : null;
};

// Ligne de handicap SIGNEE, lue dans le libelle affiche : "1 (+5.5)" -> "5.5",
// "2 (-5.5)" -> "-5.5". special_bet_value ne porte qu'une valeur non signee
// partagee par les 2 issues, elle ne suffit donc pas a orienter la ligne.
const hcpOf = (o) => {
  const m = /\(\s*([+-]?\d+(?:\.\d+)?)\s*\)/.exec(String(o?.display || ''));
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
};

const isHome = (o) => def(o).includes('competitor1');
const isAway = (o) => def(o).includes('competitor2');

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

// Totaux Over/Under (demi-lignes uniquement).
function totals(odds, m, prefixOver, prefixUnder, setNr = null) {
  for (const o of m.odds || []) {
    if (setNr !== null && setNrOf(o) !== setNr) continue;
    const L = totalOf(o);
    if (!L || !isHalfLine(L)) continue;
    const v = num(o.odd_value);
    // Le flux Congo renvoie odd_def en francais quelle que soit accept-language
    // (verifie fr + en le 2026-09-03), mais on accepte aussi les libelles
    // anglais au cas ou le skin basculerait.
    const d = def(o);
    if (d.startsWith('plus de') || d.startsWith('over')) put(odds, `${prefixOver}${L}`, v, m, o);
    else if (d.startsWith('moins de') || d.startsWith('under')) put(odds, `${prefixUnder}${L}`, v, m, o);
  }
}

// Handicaps (demi-lignes uniquement) : cle suffixee par la ligne signee du camp.
function handicaps(odds, m, prefixHome, prefixAway, setNr = null) {
  for (const o of m.odds || []) {
    if (setNr !== null && setNrOf(o) !== setNr) continue;
    const line = hcpOf(o);
    if (line == null || !isHalfLine(Math.abs(line))) continue;
    const v = num(o.odd_value);
    if (isHome(o)) put(odds, `${prefixHome}${line}`, v, m, o);
    else if (isAway(o)) put(odds, `${prefixAway}${line}`, v, m, o);
  }
}

function twoWay(odds, m, k1, k2, setNr = null) {
  for (const o of m.odds || []) {
    if (setNr !== null && setNrOf(o) !== setNr) continue;
    const d = disp(o);
    const v = num(o.odd_value);
    if (d === '1') put(odds, k1, v, m, o);
    else if (d === '2') put(odds, k2, v, m, o);
  }
}

function yesNo(odds, m, kYes, kNo) {
  for (const o of m.odds || []) {
    const d = def(o);
    const v = num(o.odd_value);
    if (d === 'oui' || d === 'yes') put(odds, kYes, v, m, o);
    else if (d === 'non' || d === 'no') put(odds, kNo, v, m, o);
  }
}

export function betikaTennisFlatOdds(markets) {
  const odds = {};
  for (const m of Array.isArray(markets) ? markets : []) {
    switch (String(m.sub_type_id)) {
      case '186': twoWay(odds, m, 'match_1', 'match_2'); break;
      case '187': handicaps(odds, m, 'hcp_home_', 'hcp_away_'); break;
      case '188': handicaps(odds, m, 'hcp_sets_home_', 'hcp_sets_away_'); break;
      case '189': totals(odds, m, 'match_over_', 'match_under_'); break;
      case '190': totals(odds, m, 'tt_home_over_', 'tt_home_under_'); break;
      case '191': totals(odds, m, 'tt_away_over_', 'tt_away_under_'); break;
      case '192': yesNo(odds, m, 'tt_home_wins_a_set_yes', 'tt_home_wins_a_set_no'); break;
      case '193': yesNo(odds, m, 'tt_away_wins_a_set_yes', 'tt_away_wins_a_set_no'); break;
      case '196': {
        // "2 sets exactement" n'est complementaire de "plus de 2.5 sets" QUE en
        // best-of-3. En best-of-5 (Grand Chelem messieurs) un match peut faire
        // 4 ou 5 sets : la paire ne couvrirait pas toutes les issues.
        for (const o of m.odds || []) {
          if (!sbv(o).includes('bestof:3')) continue;
          if (disp(o) === '2') put(odds, 'total_sets_2', num(o.odd_value), m, o);
        }
        break;
      }
      case '202': case '203': case '204': {
        // Un meme sub_type_id porte tous les sets : on ecrit chaque set sous son
        // propre prefixe s1_..s5_ d'apres setnr.
        for (const nr of ['1', '2', '3', '4', '5']) {
          const has = (m.odds || []).some((o) => setNrOf(o) === nr);
          if (!has) continue;
          const p = `s${nr}_`;
          if (String(m.sub_type_id) === '202') twoWay(odds, m, `${p}match_1`, `${p}match_2`, nr);
          else if (String(m.sub_type_id) === '203') handicaps(odds, m, `${p}hcp_home_`, `${p}hcp_away_`, nr);
          else totals(odds, m, `${p}over_`, `${p}under_`, nr);
        }
        break;
      }
      default: break;
    }
  }
  return odds;
}
