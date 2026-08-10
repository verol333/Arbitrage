import { listMatches } from './list.js';
import { getOdds } from './odds.js';

export default {
  key: 'casongo',
  label: 'Casongo',
  supports: { prematch: true, live: false },
  async listMatches({ live = false, sport = 'football' } = {}) {
    if (sport !== 'football') return [];
    return listMatches({ live, sport });
  },
  async getOdds(match, { sport = 'football', live = false, noCache = false } = {}) {
    return getOdds(match.id, { live, noCache, sport });
  },
};
