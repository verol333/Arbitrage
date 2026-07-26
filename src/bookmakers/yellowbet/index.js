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
  async getOdds(match, { live = false } = {}) {
    // En live, les Under/Over/Team totals YB sont exposés en "REST OF MATCH"
    // (buts restants), pas en TOTAL match. Le parser les redirige vers rest_*
    // pour éviter faux arbs quand comparés avec autres books qui exposent TOTAL.
    return yellowbetFlatOdds(match.__raw?.bts || [], { live });
  },
};
