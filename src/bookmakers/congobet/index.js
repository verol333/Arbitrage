import { listPrematch, listLive } from './list.js';
import { getOdds as getOddsImpl } from './odds.js';

export default {
  key: 'congobet',
  label: 'Congobet',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, sport = 'football' } = {}) {
    // Sports Congobet supportés : football (101), basketball (102), tennis (103).
    // Hockey/volley : non identifiés dans le catalogue.
    if (!['football', 'basketball', 'tennis'].includes(sport)) return [];
    return live ? listLive(sport) : listPrematch(sport);
  },
  async getOdds(match) { return getOddsImpl(match.id); },
};
