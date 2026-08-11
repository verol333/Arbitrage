import { listPrematch, listLive } from './list.js';
import { fetchMatchBts } from './api.js';
import { yellowbetFlatOdds, yellowbetBasketFlatOdds, yellowbetTennisFlatOdds } from './parse.js';

export default {
  key: 'yellowbet',
  label: 'YellowBet',
  supports: { prematch: true, live: false },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    // Tennis active 2026-08-11 apres audit + ecriture parseur tennis dedie.
    if (!['football','basket','tennis'].includes(sport)) return [];
    return live ? listLive(sport) : listPrematch(horizonHours, sport);
  },
  async getOdds(match, { live = false, noCache = false, sport = 'football' } = {}) {
    const flat = sport === 'basket' ? yellowbetBasketFlatOdds
               : sport === 'tennis' ? yellowbetTennisFlatOdds
               : yellowbetFlatOdds;
    const opts = sport === 'tennis' ? { home: match.home, away: match.away } : { live };
    if (live || noCache) {
      const bts = await fetchMatchBts(match.id);
      if (bts.length) return flat(bts, opts);
    }
    return flat(match.__raw?.bts || [], opts);
  },
};
