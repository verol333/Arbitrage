import { listPrematch, listLive } from './list.js';
import { yellowbetFlatOdds } from './parse.js';

export default {
  key: 'yellowbet',
  label: 'YellowBet',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    return live ? listLive({ sport }) : listPrematch(horizonHours, { sport });
  },
  async getOdds(match) {
    return yellowbetFlatOdds(match.__raw?.bts || []);
  },
};
