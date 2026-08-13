import { listPrematch, listLive } from './list.js';
import { fetchMatchBts } from './api.js';
import { yellowbetFlatOdds, yellowbetBasketFlatOdds, yellowbetTennisFlatOdds } from './parse.js';

export default {
  key: 'yellowbet',
  label: 'YellowBet',
  // LIVE activé 2026-08-12 : probe confirme 3 matchs foot live avec score+minute
  // réels (Chachoengsao FC vs Chanthaburi 2-1 min 73). listLive + toMatch parsent
  // ev.lv (payload JSON) pour hs/as/t/p.
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    // Tennis + Volleyball actives 2026-08-11 (structure sets identique tennis).
    if (!['football','basket','tennis','volleyball'].includes(sport)) return [];
    return live ? listLive(sport) : listPrematch(horizonHours, sport);
  },
  async getOdds(match, { live = false, noCache = false, sport = 'football' } = {}) {
    // Volleyball : reutilise parseur tennis (2 Way + 1st/2nd Set Winner + Set
    // Handicap + Total Points ~= Total Games avec noms similaires).
    const flat = sport === 'basket' ? yellowbetBasketFlatOdds
               : sport === 'tennis' || sport === 'volleyball' ? yellowbetTennisFlatOdds
               : yellowbetFlatOdds;
    const opts = (sport === 'tennis' || sport === 'volleyball') ? { home: match.home, away: match.away } : { live };
    if (live || noCache) {
      const bts = await fetchMatchBts(match.id);
      if (bts.length) return flat(bts, opts);
    }
    return flat(match.__raw?.bts || [], opts);
  },
};
