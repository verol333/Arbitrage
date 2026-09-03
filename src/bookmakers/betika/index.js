import { listBetika } from './list.js';
import { btkFetchMatch } from './api.js';
import { betikaFlatOdds } from './parse.js';

// Betika : les cotes completes ne sont disponibles que par match (/v1/uo/match),
// donc getOdds refait toujours une lecture fraiche — indispensable en live.
export default {
  key: 'betika',
  label: 'Betika',
  supports: { prematch: true, live: true },
  async listMatches({ sport = 'football', live = false, horizonHours = 48 } = {}) {
    if (sport !== 'football') return [];
    return listBetika({ sport, live, horizonHours });
  },
  async getOdds(match, { sport = 'football' } = {}) {
    if (sport !== 'football') return {};
    const root = await btkFetchMatch(match.id);
    const markets = Array.isArray(root?.data) ? root.data : [];
    if (!markets.length) return {};
    const odds = betikaFlatOdds(markets, { sport });
    // Le code coupon Betika se genere depuis (parent_match_id, outcome_id).
    for (const meta of Object.values(odds._ids || {})) meta.match_id = String(match.id);
    return odds;
  },
};
