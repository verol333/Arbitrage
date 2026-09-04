// Conversion des marchés BASKET MaxiBet (Swarm) vers le vocabulaire standard.
// Swarm sport id=3 (Basketball). Match Winner 2-way (P1P2), Total Points, Handicap
// Points, totaux par equipe et pair/impair. Les marchés 3-way regulation (P1XP2),
// quart-temps, mi-temps et joueurs sont ignorés : non comparables et/ou par nom.
// Demi-lignes seulement (isHalfLine).
import { isHalfLine } from '../../core/markets.js';

const FIXED = {
  P1P2: { W1: 'match_1', W2: 'match_2' },
  MatchOddEvenTotal: { Odd: 'odd', Even: 'even' },
};

const TOTALS = {
  MatchTotal: ['match_over_', 'match_under_'],
  MatchHomeTeamTotal2: ['tt_home_over_', 'tt_home_under_'],
  MatchAwayTeamTotal2: ['tt_away_over_', 'tt_away_under_'],
};

const HANDICAPS = {
  MatchHandicap: ['hcp_home_', 'hcp_away_'],
};

function put(odds, key, value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 1) return;
  if (odds[key] == null || v > odds[key]) odds[key] = v;
}
const fmt = (n) => String(Number(n));

export function maxibetBasketFlatOdds(markets = []) {
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
