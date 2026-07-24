import { listMatches } from './list.js';
import { sportcashFlatOdds } from './parse.js';

export default {
  key: 'sportcash',
  label: 'Sportcash',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours } = {}) {
    return listMatches({ live, horizonHours });
  },
  async getOdds(match) { return sportcashFlatOdds(match.__raw?.markets || []); },
};
