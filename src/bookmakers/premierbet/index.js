import { listMatches } from './list.js';
import { getOdds } from './odds.js';

export default {
  key: 'premierbet',
  label: 'PremierBet',
  supports: { prematch: true, live: false }, // live = trop cher (budget Scrape.do 1000/mois)
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    if (sport !== 'football') return [];
    // Horizon étendu à 168h (7j) pour capturer plus d'events depuis bestsellers.
    return listMatches({ live, horizonHours: 168 });
  },
  async getOdds(match) { return getOdds(match); },
};
