import { listPrematch, listLive } from './list.js';
import { fetchMatchBts } from './api.js';
import { yellowbetFlatOdds, yellowbetBasketFlatOdds } from './parse.js';

export default {
  key: 'yellowbet',
  label: 'YellowBet',
  supports: { prematch: true, live: false },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    if (sport !== 'football' && sport !== 'basket') return [];
    return live ? listLive(sport) : listPrematch(horizonHours, sport);
  },
  async getOdds(match, { live = false, noCache = false, sport = 'football' } = {}) {
    const flat = sport === 'basket' ? yellowbetBasketFlatOdds : yellowbetFlatOdds;
    if (live || noCache) {
      const bts = await fetchMatchBts(match.id);
      if (bts.length) return flat(bts, { live });
    }
    return flat(match.__raw?.bts || [], { live });
  },
};
