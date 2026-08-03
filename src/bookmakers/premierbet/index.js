import { listMatches } from './list.js';
import { getOdds } from './odds.js';

export default {
  key: 'premierbet',
  label: 'PremierBet',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    if (sport !== 'football' && sport !== 'tennis') return [];
    return listMatches({ live, horizonHours: horizonHours || 168, sport });
  },
  async getOdds(match, { live = false, noCache = false, sport = 'football' } = {}) { return getOdds(match, { live, noCache, sport }); },
};
