import { listMatches } from './list.js';
import { betpawaFlatOdds } from './parse.js';

export default {
  key: 'betpawa',
  label: 'BetPawa',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    // BetPawa Congo — category 2 = Football uniquement pour l'instant.
    if (sport !== 'football') return [];
    return listMatches({ live, horizonHours });
  },
  async getOdds(match) {
    // Les cotes sont déjà dans __raw (listMatches fait l'appel qui contient
    // events + odds), donc getOdds parse depuis le buffer déjà récupéré.
    return betpawaFlatOdds(match);
  },
};
