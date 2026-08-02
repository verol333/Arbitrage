import { listPrematch, listLive } from './list.js';
import { fetchMatchBts } from './api.js';
import { yellowbetFlatOdds } from './parse.js';

export default {
  key: 'yellowbet',
  label: 'YellowBet',
  supports: { prematch: true, live: false }, // live désactivé (mapping 'rest_*' non fiable en cross-book, produit fake arbs)
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    if (sport !== 'football') return [];
    return live ? listLive(sport) : listPrematch(horizonHours, sport);
  },
  // En LIVE (ou confirm noCache) → re-fetch fresh via GetEventDetails.
  // Sinon → réutilise les bts capturés au listMatches.
  // Le parser reroute Under/Over/TT en 'rest_*' quand live=true (les cotes YB
  // exposées en live représentent "REST OF MATCH", buts restants).
  async getOdds(match, { live = false, noCache = false } = {}) {
    if (live || noCache) {
      const bts = await fetchMatchBts(match.id);
      if (bts.length) return yellowbetFlatOdds(bts, { live });
    }
    return yellowbetFlatOdds(match.__raw?.bts || [], { live });
  },
};
