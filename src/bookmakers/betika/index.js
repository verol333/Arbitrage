import { listBetika } from './list.js';
import { btkFetchMatch } from './api.js';
import { betikaFlatOdds } from './parse.js';

// Betika : les cotes completes ne sont disponibles que par match (/v1/uo/match),
// donc getOdds refait toujours une lecture fraiche a chaque cycle.
// live: false — l'API publique n'expose aucun flux in-play (voir list.js).
export default {
  key: 'betika',
  label: 'Betika',
  supports: { prematch: true, live: false },
  async listMatches({ sport = 'football', live = false, horizonHours = 72 } = {}) {
    if (sport !== 'football' || live) return [];
    return listBetika({ sport, live, horizonHours });
  },
  async getOdds(match, { sport = 'football', live = false } = {}) {
    if (sport !== 'football' || live) return {};
    const root = await btkFetchMatch(match.id);
    const markets = Array.isArray(root?.data) ? root.data : [];
    if (!markets.length) return {};
    const odds = betikaFlatOdds(markets, { sport });
    // Le code coupon Betika se genere depuis (parent_match_id, outcome_id).
    for (const meta of Object.values(odds._ids || {})) meta.match_id = String(match.id);
    return odds;
  },
};
