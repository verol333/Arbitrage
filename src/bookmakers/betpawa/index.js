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
  async getOdds(match) {
    // Chaque match nécessite un appel /events/{id} pour récupérer markets + cotes.
    const eventJson = await bpFetchEvent(match.id);
    if (!eventJson) return {};
    return betpawaFlatOdds(eventJson);
  },
};
