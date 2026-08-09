import { listMatches, fetchOffers } from './list.js';
import { apolloFlatOdds } from './parse.js';

export default {
  key: 'apollo',
  label: 'Apollo Games',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, sport = 'football' } = {}) {
    if (sport !== 'football' && sport !== 'tennis' && sport !== 'basket') return [];
    return listMatches({ live, sport });
  },
  async getOdds(match, { sport = 'football' } = {}) {
    const map = await fetchOffers([match.id]);
    return apolloFlatOdds(map.get(match.id) || [], { sport });
  },
  async getOddsBatch(matches, { sport = 'football' } = {}) {
    if (!matches.length) return new Map();
    const map = await fetchOffers(matches.map((m) => m.id));
    const out = new Map();
    for (const m of matches) out.set(m.id, apolloFlatOdds(map.get(m.id) || [], { sport }));
    return out;
  },
};
