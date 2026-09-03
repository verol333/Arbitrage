// Conversion des marchés MaxiBet (Swarm) vers le vocabulaire standard.
//
// Deux règles de sûreté, non négociables :
//   1) WHITELIST — seuls les types listés ci-dessous sont lus. Les 300+ autres
//      types (combinés, buteurs, marges exactes, tranches 1-15/1-30…) sont
//      ignorés : aucun risque d'appariement fantaisiste.
//   2) DEMI-LIGNES SEULEMENT — MaxiBet mélange dans un MÊME type des lignes
//      quart (0.25/0.75 : remboursement partiel) et entières (1, 2 : match nul
//      remboursé) avec les demi-lignes. Seules les X.5 donnent un arbitrage
//      garanti, isHalfLine les filtre.
//
// L'appariement se fait sur `type` (code technique) et `type_1` (code d'issue),
// jamais sur les libellés : ceux-ci sont traduits et changent selon la langue.
import { isHalfLine } from '../../core/markets.js';

// Marchés à issues fixes : type MaxiBet → { type_1 → clé standard }.
const FIXED = {
  P1XP2: { W1: 'match_1', X: 'match_X', W2: 'match_2' },
  '1X12X2': { '1X': 'dc_1X', '12': 'dc_12', X2: 'dc_X2' },
  // Draw No Bet natif, confirmé sur les grosses affiches (Real Sociedad-Celta).
  DrawNoBet: { Team1: 'dnb_1', Team2: 'dnb_2' },
  BothTeamsToScore: { Yes: 'btts_yes', No: 'btts_no' },
  HalfTimeResult: { W1: 'ht_match_1', X: 'ht_match_X', W2: 'ht_match_2' },
  HalfTimeDoubleChance: { '1X': 'ht_dc_1X', '12': 'ht_dc_12', X2: 'ht_dc_X2' },
  '1stHalfBothTeamsToScore': { Yes: 'ht_btts_yes', No: 'ht_btts_no' },
  '2ndHalfBothTeamsToScore': { Yes: 'h2_btts_yes', No: 'h2_btts_no' },
  CornerOddEven: { Odd: 'cor_odd', Even: 'cor_even' },
};

// Marchés à ligne (Over/Under) : type MaxiBet → préfixe des clés standard.
const TOTALS = {
  OverUnder: ['match_over_', 'match_under_'],
  Team1OverUnder: ['tt_home_over_', 'tt_home_under_'],
  Team2OverUnder: ['tt_away_over_', 'tt_away_under_'],
  HalfTimeOverUnder: ['ht_over_', 'ht_under_'],
  'HalfTimeOverUnderAsian': ['ht_over_', 'ht_under_'],
  '2ndHalfTotalOver/Under': ['h2_over_', 'h2_under_'],
  HalfTimeTeam1OverUnder: ['ht_tt_home_over_', 'ht_tt_home_under_'],
  HalfTimeTeam2OverUnder: ['ht_tt_away_over_', 'ht_tt_away_under_'],
  CornersOverUnder: ['cor_over_', 'cor_under_'],
  HalfTimeCornersOverUnder: ['cor_ht_over_', 'cor_ht_under_'],
};

// Handicaps 2 voies : type MaxiBet → préfixe. La ligne est portée par chaque
// issue (base) et déjà signée du point de vue de son camp.
const HANDICAPS = {
  AsianHandicap: ['hcp_home_', 'hcp_away_'],
  HalfTimeAsianHandicap: ['ht_hcp_home_', 'ht_hcp_away_'],
  '2ndHalfAsianHandicap': ['h2_hcp_home_', 'h2_hcp_away_'],
  CornerHandicap: ['cor_hcp_home_', 'cor_hcp_away_'],
};

// MaxiBet publie la même ligne en plusieurs variantes (« Total Goals » et
// « Total Goals Asian ») : on garde la meilleure cote réellement offerte.
function put(odds, key, value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 1) return;
  if (odds[key] == null || v > odds[key]) odds[key] = v;
}

// Formate la ligne comme le reste du système : 2.5, -1.5 (sans zéros inutiles).
const fmt = (n) => String(Number(n));

export function maxibetFlatOdds(markets = []) {
  const odds = {};
  for (const m of markets) {
    const type = m?.type;
    if (!type) continue;
    const events = Object.values(m.event || {});
    if (!events.length) continue;

    const fixed = FIXED[type];
    if (fixed) {
      for (const e of events) {
        const key = fixed[e.type_1];
        if (key) put(odds, key, e.price);
      }
      continue;
    }

    const total = TOTALS[type];
    if (total) {
      for (const e of events) {
        const line = Number(e.base);
        if (!Number.isFinite(line) || !isHalfLine(line)) continue;
        if (e.type_1 === 'Over') put(odds, total[0] + fmt(line), e.price);
        else if (e.type_1 === 'Under') put(odds, total[1] + fmt(line), e.price);
      }
      continue;
    }

    const hcp = HANDICAPS[type];
    if (hcp) {
      for (const e of events) {
        const line = Number(e.base);
        if (!Number.isFinite(line) || !isHalfLine(line)) continue;
        if (e.type_1 === 'Home') put(odds, hcp[0] + fmt(line), e.price);
        else if (e.type_1 === 'Away') put(odds, hcp[1] + fmt(line), e.price);
      }
    }
  }
  return odds;
}
