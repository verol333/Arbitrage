import { listMatches } from './list.js';
import { bpFetchEvent } from './api.js';
import { betpawaFlatOdds } from './parse.js';

export default {
  key: 'betpawa',
  label: 'BetPawa',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    if (sport !== 'football') return [];
    return listMatches({ live, horizonHours });
  },
  async getOdds(match, { live = false, noCache = false } = {}) {
    // En live ou confirm noCache → bypass cache pour cotes fraîches du moment.
    // En prématch → cache 30s OK (cotes bougent peu, économise des requêtes).
    const eventJson = await bpFetchEvent(match.id, 15_000, { fresh: live || noCache });
    if (!eventJson) return {};
    return betpawaFlatOdds(eventJson);
  },
};
