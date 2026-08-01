import { listPrematch, listLive } from './list.js';
import { sbFetchEvent } from './api.js';
import { sportybetFlatOdds } from './parse.js';

export default {
  key: 'sportybet',
  label: 'SportyBet',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, sport = 'football' } = {}) {
    if (sport !== 'football') return [];
    return live ? listLive() : listPrematch();
  },
  // En LIVE (ou confirm noCache) → re-fetch fresh via /event?eventId=...
  // Sinon → réutilise les markets capturés au listMatches (rapide, une seule requête).
  async getOdds(match, { live = false, noCache = false } = {}) {
    if (live || noCache) {
      const evt = await sbFetchEvent(match.id);
      const markets = Array.isArray(evt?.data?.markets) ? evt.data.markets : [];
      if (markets.length) return sportybetFlatOdds(markets);
    }
    return sportybetFlatOdds(match.__raw?.markets || []);
  },
};
