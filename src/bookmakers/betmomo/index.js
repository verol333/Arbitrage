import { listMatches } from './list.js';
import { betmomoFlatOdds } from './parse.js';

export default {
  key: 'betmomo',
  label: 'BetMomo',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours } = {}) {
    return listMatches({ live, horizonHours });
  },
  async getOdds(match) { return betmomoFlatOdds(match.__raw?.markets || []); },
};
