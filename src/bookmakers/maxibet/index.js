import { listMatches } from './list.js';
import { fetchMatchOdds } from './api.js';
import { maxibetFlatOdds } from './parse.js';

export default {
  key: 'maxibet',
  label: 'Maxibet',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    if (sport !== 'football' && sport !== 'tennis') return [];
    return listMatches({ live, horizonHours, sport });
  },
  async getOdds(match, { live = false, noCache = false, sport = 'football' } = {}) {
    if (live || noCache) {
      const markets = await fetchMatchOdds(match.id);
      if (markets.length) return maxibetFlatOdds(markets, { sport });
    }
    return maxibetFlatOdds(match.__raw?.markets || [], { sport });
  },
};
