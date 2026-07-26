import { listPrematch, listLive } from './list.js';
import { yellowbetFlatOdds } from './parse.js';

export default {
  key: 'yellowbet',
  label: 'YellowBet',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    // Sports YellowBet supportés : football (31), basketball (32),
    // tennis (35), volleyball (323). Hockey : non identifié.
    if (!['football', 'basketball', 'tennis', 'volleyball'].includes(sport)) return [];
    return live ? listLive(sport) : listPrematch(horizonHours, sport);
  },
  async getOdds(match) {
    return yellowbetFlatOdds(match.__raw?.bts || []);
  },
};
