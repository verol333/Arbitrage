// Conversion des marchés TABLE TENNIS MaxiBet (Swarm) vers le vocabulaire standard.
// Swarm sport id=41. 3 marchés seulement : vainqueur 2-way, handicap points,
// pair/impair. Reutilise le comparateur tennis (compareTennisTwoBooks) qui lit
// match_1/2, hcp_home/away et odd/even. Demi-lignes seulement (isHalfLine).
import { isHalfLine } from '../../core/markets.js';

const FIXED = {
  P1P2: { W1: 'match_1', W2: 'match_2' },
  MatchEvenOdd: { Odd: 'odd', Even: 'even' },
};

const HANDICAPS = {
  MatchPointHandicap: ['hcp_home_', 'hcp_away_'],
};

function put(odds, key, value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 1) return;
  if (odds[key] == null || v > odds[key]) odds[key] = v;
}
const fmt = (n) => String(Number(n));

export function maxibetTableTennisFlatOdds(markets = []) {
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
