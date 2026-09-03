import { listBetclic } from './list.js';
import { bcMatchMarkets } from './api.js';
import { betclicFlatOdds } from './parse.js';

// Betclic (backend gRPC-web offering.begmedia.com, regulation CI) : aucune
// authentification, joignable en direct depuis les runners GitHub. Les cotes se
// lisent match par match, categorie par categorie -> getOdds fait 5 appels.
// Foot pre-match seulement (voir list.js pour le direct).
export default {
  key: 'betclic',
  label: 'Betclic',
  supports: { prematch: true, live: false },
  async listMatches({ sport = 'football', live = false, horizonHours = 72 } = {}) {
    if (sport !== 'football' || live) return [];
    return listBetclic({ sport, live, horizonHours });
  },
  async getOdds(match, { sport = 'football', live = false } = {}) {
    if (sport !== 'football' || live) return {};
    const markets = await bcMatchMarkets(match.id, { regulation: 'CI' });
    if (!markets.length) return {};
    const odds = betclicFlatOdds(markets, { home: match.home, away: match.away });
    for (const meta of Object.values(odds._ids || {})) meta.match_id = String(match.id);
    return odds;
  },
};
