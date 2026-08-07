import { listMatches } from './list.js';
import { bpFetchEvent } from './api.js';
import { betpawaFlatOdds, betpawaTennisFlatOdds, betpawaBasketFlatOdds } from './parse.js';

export default {
  key: 'betpawa',
  label: 'BetPawa',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    if (!['football', 'tennis', 'basket'].includes(sport)) return [];
    return listMatches({ live, horizonHours, sport });
  },
  async getOdds(match, { live = false, noCache = false, sport = 'football' } = {}) {
    // En live ou confirm noCache → bypass cache pour cotes fraîches du moment.
    // En prématch → cache 30s OK (cotes bougent peu, économise des requêtes).
    const eventJson = await bpFetchEvent(match.id, 15_000, { fresh: live || noCache });
    if (!eventJson) return {};
    const flat = sport === 'tennis' ? betpawaTennisFlatOdds
               : sport === 'basket' ? betpawaBasketFlatOdds
               : betpawaFlatOdds;
    return flat(eventJson);
  },
};
