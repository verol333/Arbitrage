import { listPrematch } from './list.js';
import { getOdds } from './odds.js';

// Bet9ja (sports.bet9ja.com) : flux public anonyme, foot pré-match pour
// l'instant. Le live du site passe par un autre point d'entrée (non couvert),
// d'où supports.live = false.
export default {
  key: 'bet9ja',
  label: 'Bet9ja',
  supports: { prematch: true, live: false },
  async listMatches({ live = false, sport = 'football', horizonHours } = {}) {
    if (live) return [];
    return listPrematch(sport, horizonHours ? { horizonHours } : undefined);
  },
  async getOdds(match, { noCache = false } = {}) {
    return getOdds(match.id, { noCache });
  },
};
