// Parseurs Mozzartbet pour les sports HORS football : tennis, basket, hockey,
// tennis de table. Mapping deterministe par (gameId, subGameName), libelles en
// anglais (lang:'en' force dans api.js). Verifie le 06/09/2026 sur :
//   tennis  Alcaraz C. - Paul T.        basket  Crvena Zvezda - Olympiakos
//   hockey  Norilsk - Dinamo Altay      tennis de table  Biolek M. - Opanasiuk D.
//
// CONVENTION HANDICAP MOZZART (verifiee sur les cotes) : specialOddValue porte
// la ligne DU CAMP DOMICILE, identique pour les deux issues.
//   "1@-6.5"=2.08 / "2@-6.5"=1.75  (Alcaraz favori 1.17) -> home -6.5 / away +6.5
//   "1@6.5"=1.85  / "2@6.5"=1.85   (Zvezda outsider 3.50) -> home +6.5 / away -6.5
//   "1@1.5"=1.10  (Alcaraz +1.5 sets)                    -> hcp_sets_home_1.5
// Donc : issue 1 -> <prefixe_home><L>, issue 2 -> <prefixe_away><-L>.
// Demi-lignes uniquement (isHalfLine) : aucune ligne entiere (remboursement).
// Les groupes "combinations", scores exacts, fourchettes et "yes/no 13" sont
// volontairement ignores : pas d'opposition garantie.
import { isHalfLine } from '../../core/markets.js';

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 1.01 ? n : null;
};
const fmt = (n) => String(Number(n));

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

// Ligne portee par specialOddValue (-1 = aucune ligne).
function special(o) {
  const s = Number(o?.specialOddValue);
  return Number.isFinite(s) && s !== -1 ? s : null;
}

// Issue "1"/"2" -> cles fixes.
function twoWay(odds, o, n, k1, k2) {
  if (n === '1') put(odds, k1, num(o.value), o);
  else if (n === '2') put(odds, k2, num(o.value), o);
}

// "under"/"over" avec la ligne dans specialOddValue (ex: under@35.5).
function totalSpecial(odds, o, n, preOver, preUnder) {
  const line = special(o);
  if (line == null || !isHalfLine(line)) return;
  if (n === 'over') put(odds, preOver + fmt(line), num(o.value), o);
  else if (n === 'under') put(odds, preUnder + fmt(line), num(o.value), o);
}

// "over 4.5" / "un 9.5" / "ov 9.5" : ligne dans le libelle.
function totalInName(odds, o, n, preOver, preUnder) {
  const m = /^(ov|over|un|under)\s+([\d.]+)$/.exec(n);
  if (!m || !isHalfLine(m[2])) return;
  const over = m[1] === 'ov' || m[1] === 'over';
  put(odds, (over ? preOver : preUnder) + fmt(m[2]), num(o.value), o);
}

// Handicap 2 voies, ligne domicile dans specialOddValue.
function hcpSpecial(odds, o, n, preHome, preAway) {
  const line = special(o);
  if (line == null || !isHalfLine(line)) return;
  if (n === '1') put(odds, preHome + fmt(line), num(o.value), o);
  else if (n === '2') put(odds, preAway + fmt(-line), num(o.value), o);
}

function active(kodds) {
  return Object.values(kodds || {}).filter((o) => o?.subGame && o?.winStatus === 'ACTIVE');
}
const nameOf = (o) => String(o.subGame.subGameName || '').trim().toLowerCase();
const groupOf = (o) => String(o.subGame.gameName || '').toLowerCase();

// ── TENNIS ─────────────────────────────────────────────────────────────
//  17 Match Winner            87 Total Games (+ even/odd)   554/557 Total games
//  85/555/556 Handicap games  1/558 Handicap sets           22 1st Set Winner
//  138 1st Set Total Games    193 1st Set Game Handicap
export function mozzartTennisFlatOdds(kodds) {
  const odds = {};
  for (const o of active(kodds)) {
    const g = String(o.subGame.gameId);
    const n = nameOf(o);
    const gn = groupOf(o);
    switch (g) {
      case '17': twoWay(odds, o, n, 'match_1', 'match_2'); break;
      case '87':
        if (n === 'even') put(odds, 'even', num(o.value), o);
        else if (n === 'odd') put(odds, 'odd', num(o.value), o);
        else totalSpecial(odds, o, n, 'match_over_', 'match_under_');
        break;
      case '554': case '557':
        if (gn.includes('total')) totalSpecial(odds, o, n, 'match_over_', 'match_under_');
        break;
      case '85': case '555': case '556':
        if (gn.includes('handicap') && gn.includes('game')) hcpSpecial(odds, o, n, 'hcp_home_', 'hcp_away_');
        break;
      case '1': case '558':
        if (gn.includes('handicap') && gn.includes('set')) hcpSpecial(odds, o, n, 'hcp_sets_home_', 'hcp_sets_away_');
        break;
      case '22': twoWay(odds, o, n, 's1_match_1', 's1_match_2'); break;
      case '138': totalInName(odds, o, n, 's1_over_', 's1_under_'); break;
      case '193': hcpSpecial(odds, o, n, 's1_hcp_home_', 's1_hcp_away_'); break;
      default: break;
    }
  }
  return odds;
}

// ── BASKET ─────────────────────────────────────────────────────────────
//  196 Match Winner (2 voies, OT inclus)   27/749-752 Total Points
//  1/735-738 Match Points Handicap         181/183 Total Points par equipe
export function mozzartBasketFlatOdds(kodds) {
  const odds = {};
  for (const o of active(kodds)) {
    const g = String(o.subGame.gameId);
    const n = nameOf(o);
    const gn = groupOf(o);
    switch (g) {
      case '196': twoWay(odds, o, n, 'match_1', 'match_2'); break;
      case '27': case '749': case '750': case '751': case '752':
        if (gn.includes('total')) totalSpecial(odds, o, n, 'match_over_', 'match_under_');
        break;
      case '1': case '735': case '736': case '737': case '738':
        if (gn.includes('handicap')) hcpSpecial(odds, o, n, 'hcp_home_', 'hcp_away_');
        break;
      case '181': totalSpecial(odds, o, n, 'tt_home_over_', 'tt_home_under_'); break;
      case '183': totalSpecial(odds, o, n, 'tt_away_over_', 'tt_away_under_'); break;
      default: break;
    }
  }
  return odds;
}

// ── HOCKEY (glace) ─────────────────────────────────────────────────────
//  17 Final result (temps reglementaire, 3 voies)   2 Double chance
//   3 Total goals ("over 4.5")
//  26 "Winner" (OT inclus) volontairement ignore : non comparable au 3 voies.
export function mozzartHockeyFlatOdds(kodds) {
  const odds = {};
  for (const o of active(kodds)) {
    const g = String(o.subGame.gameId);
    const n = nameOf(o);
    switch (g) {
      case '17':
        if (n === '1') put(odds, 'match_1', num(o.value), o);
        else if (n === 'x') put(odds, 'match_X', num(o.value), o);
        else if (n === '2') put(odds, 'match_2', num(o.value), o);
        break;
      case '2':
        if (n === '1x') put(odds, 'dc_1X', num(o.value), o);
        else if (n === '12') put(odds, 'dc_12', num(o.value), o);
        else if (n === 'x2') put(odds, 'dc_X2', num(o.value), o);
        break;
      case '3': totalInName(odds, o, n, 'match_over_', 'match_under_'); break;
      default: break;
    }
  }
  return odds;
}

// ── TENNIS DE TABLE ────────────────────────────────────────────────────
//  17 Winner (2 voies). Seul marche expose par Mozzart sur ce sport.
export function mozzartTableTennisFlatOdds(kodds) {
  const odds = {};
  for (const o of active(kodds)) {
    if (String(o.subGame.gameId) === '17') twoWay(odds, o, nameOf(o), 'match_1', 'match_2');
  }
  return odds;
}
