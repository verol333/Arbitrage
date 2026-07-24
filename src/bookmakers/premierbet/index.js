import { listMatches } from './list.js';
import { premierbetFlatOdds } from './parse.js';

export default {
  key: 'premierbet',
  label: 'PremierBet',
  supports: { prematch: true, live: false },
  async listMatches({ live = false, horizonHours } = {}) {
    return listMatches({ live, horizonHours });
  },
  async getOdds(match) { return premierbetFlatOdds(match.__raw?.markets || []); },
};
