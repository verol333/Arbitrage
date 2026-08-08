import { listPrematch, listLive } from './list.js';
import { getOdds as getOddsImpl } from './odds.js';

export default {
  key: 'congobet',
  label: 'Congobet',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, sport = 'football' } = {}) {
    if (sport !== 'football' && sport !== 'tennis') return [];
    return live ? listLive(sport) : listPrematch(sport);
  },
  async getOdds(match, { live = false, noCache = false } = {}) { return getOddsImpl(match.id, { live, noCache }); },
};
