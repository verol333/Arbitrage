import { listPrematch, listLive } from './list.js';
import { yellowbetFlatOdds } from './parse.js';

export default {
  key: 'yellowbet',
  label: 'YellowBet',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    if (sport !== 'football') return []; // tennis endpoint non validé pour YellowBet
    return live ? listLive() : listPrematch(horizonHours);
  },
  async getOdds(match) {
    return yellowbetFlatOdds(match.__raw?.bts || []);
  },
};
