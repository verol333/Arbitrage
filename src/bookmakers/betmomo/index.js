import { listMatches } from './list.js';
import { fetchMatchOdds } from './api.js';
import { betmomoFlatOdds } from './parse.js';

export default {
  key: 'betmomo',
  label: 'BetMomo',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    if (!['football','tennis','basket','hockey','volleyball','table_tennis'].includes(sport)) return [];
    return listMatches({ live, horizonHours, sport });
  },
  // getOdds : par défaut on utilise les cotes capturées au listMatches (rapide).
  // En mode noCache (confirm re-fetch juste avant envoi) et en LIVE, on force
  // un re-fetch dédié via SWARM sur cet unique game → cotes fraîches.
  async getOdds(match, { live = false, noCache = false, sport = 'football' } = {}) {
    if (live || noCache) {
      const markets = await fetchMatchOdds(match.id);
      if (markets.length) return betmomoFlatOdds(markets, { sport });
    }
    return betmomoFlatOdds(match.__raw?.markets || [], { sport });
  },
};
