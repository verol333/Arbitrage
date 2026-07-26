import { listMatches } from './list.js';
import { betmomoFlatOdds } from './parse.js';

export default {
  key: 'betmomo',
  label: 'BetMomo',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    return listMatches({ live, horizonHours, sport });
  },
  async getOdds(match) { return betmomoFlatOdds(match.__raw?.markets || []); },
};
