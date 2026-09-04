// Conversion des marchés VOLLEYBALL MaxiBet (Swarm) vers le vocabulaire standard.
// Swarm sport id=5. Match-level uniquement : vainqueur 2-way, total points,
// totaux par equipe, handicap des sets, total des sets, pair/impair.
// Les marchés par set (SetWinner, SetTotalOverUnder…) sont ignorés : leur type
// Swarm ne porte pas le numero de set (seul le nom le fait), trop risque a mapper.
// Demi-lignes seulement (isHalfLine) — aucune ligne entière (remboursement).
import { isHalfLine } from '../../core/markets.js';

const FIXED = {
  P1P2: { W1: 'match_1', W2: 'match_2' },
  MatchTotalEvenOdd: { Odd: 'odd', Even: 'even' },
};

const TOTALS = {
  'TotalPointsOver/Under': ['match_over_', 'match_under_'],
  'HomeTeamOver/Under': ['tt_home_over_', 'tt_home_under_'],
  'AwayTeamOver/Under': ['tt_away_over_', 'tt_away_under_'],
  TotalbySets: ['total_sets_over_', 'total_sets_under_'],
};

// « Sets Handicap » (best-of-3 ±1.5 ou best-of-5 ±2.5) — cle hcp_sets_.
const SETS_HANDICAP = {
  SetPointHandicap: ['hcp_sets_home_', 'hcp_sets_away_'],
};

function put(odds, key, value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 1) return;
  if (odds[key] == null || v > odds[key]) odds[key] = v;
}
const fmt = (n) => String(Number(n));

export function maxibetVolleyballFlatOdds(markets = []) {
  const odds = {};
  for (const m of markets) {
    const type = m?.type;
    if (!type) continue;
    const events = Object.values(m.event || {});
    if (!events.length) continue;

    const fixed = FIXED[type];
    if (fixed) {
      for (const e of events) { const key = fixed[e.type_1]; if (key) put(odds, key, e.price); }
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
    const sh = SETS_HANDICAP[type];
    if (sh) {
      for (const e of events) {
        const line = Number(e.base);
        if (!Number.isFinite(line) || !isHalfLine(line)) continue;
        if (e.type_1 === 'Home') put(odds, sh[0] + fmt(line), e.price);
        else if (e.type_1 === 'Away') put(odds, sh[1] + fmt(line), e.price);
      }
    }
  }
  return odds;
}
