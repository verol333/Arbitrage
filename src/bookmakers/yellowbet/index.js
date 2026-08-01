import { listPrematch, listLive } from './list.js';
import { yellowbetFlatOdds } from './parse.js';

export default {
  key: 'yellowbet',
  label: 'YellowBet',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    if (sport !== 'football') return [];
    return live ? listLive(sport) : listPrematch(horizonHours, sport);
  },
  async getOdds(match, { live = false } = {}) {
    // En live, les Under/Over/Team totals YB sont exposés en "REST OF MATCH"
    // (buts restants), pas en TOTAL match. Le parser les redirige vers rest_*
    // pour éviter faux arbs quand comparés avec autres books qui exposent TOTAL.
    return yellowbetFlatOdds(match.__raw?.bts || [], { live });
  },
};
