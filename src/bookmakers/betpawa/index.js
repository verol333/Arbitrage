import { listMatches } from './list.js';
import { betpawaFlatOdds } from './parse.js';

export default {
  key: 'betpawa',
  label: 'BetPawa',
  // Prematch + live via appel direct cg.betpawa.com + décodage protobuf float.
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    if (sport !== 'football') return [];
    return listMatches({ live, horizonHours });
  },
  async getOdds(match) {
    return betpawaFlatOdds(match);
  },
};
