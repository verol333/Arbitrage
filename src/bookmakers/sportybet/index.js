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
  // LIVE : re-fetch fresh via /event?productId=1 OBLIGATOIRE. Le fallback sur
  // __raw.markets (issus de liveOrPrematchEvents) contient potentiellement des
  // cotes PRÉMATCH pour les matchs live → produisait fake arbs (user report :
  // Fittja vs IFK Haninge 0-1 à 53', Away @ 2.05 alors que devrait être ~1.40).
  // Si sbFetchEvent live retourne vide, on renvoie {} — mieux 0 cote que fake.
  //
  // PREMATCH : peut réutiliser __raw.markets (capturé par listPrematch avec
  // markets embedded via pcUpcomingEvents) SAUF si noCache demandé (confirm).
  async getOdds(match, { live = false, noCache = false } = {}) {
    if (live) {
      const evt = await sbFetchEvent(match.id, { live: true });
      const markets = Array.isArray(evt?.data?.markets) ? evt.data.markets : [];
      return markets.length ? sportybetFlatOdds(markets, { live: true }) : {};
    }
    if (noCache) {
      const evt = await sbFetchEvent(match.id, { live: false });
      const markets = Array.isArray(evt?.data?.markets) ? evt.data.markets : [];
      if (markets.length) return sportybetFlatOdds(markets, { live: false });
    }
    return sportybetFlatOdds(match.__raw?.markets || [], { live: false });
  },
};
