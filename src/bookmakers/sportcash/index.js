import { listMatches } from './list.js';
import { fetchMatchOdds } from './api.js';
import { sportcashFlatOdds } from './parse.js';

export default {
  key: 'sportcash',
  label: 'Sportcash',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    if (sport !== 'football') return [];
    return listMatches({ live, horizonHours });
  },
  // En LIVE (ou confirm noCache) → re-fetch fresh via getEvento sur pal/avv
  // stockés dans __raw. En prématch → réutilise les markets capturés au list.
  async getOdds(match, { live = false, noCache = false } = {}) {
    if (live || noCache) {
      const markets = await fetchMatchOdds(match.__raw || {});
      if (markets.length) return sportcashFlatOdds(markets);
    }
    return sportcashFlatOdds(match.__raw?.markets || []);
  },
};
