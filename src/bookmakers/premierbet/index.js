import { listMatches } from './list.js';
import { getOdds } from './odds.js';

// PremierBet Congo — API mobile (sports-api.premierbet.com/cg/v1). Publique et
// rapide → prématch + live supportés sans budget proxy externe.
export default {
  key: 'premierbet',
  label: 'PremierBet',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    if (sport !== 'football') return [];
    return listMatches({ live, horizonHours });
  },
  async getOdds(match, { live = false } = {}) {
    return getOdds(match, { live });
  },
};
