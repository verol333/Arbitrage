import { listPrematch } from './list.js';
import { maxibetFlatOdds } from './parse.js';

export default {
  key: 'maxibet',
  label: 'MaxiBet',
  // Skin BetConstruct (site_id 1870852) : les cotes passent par le WebSocket
  // Swarm, ce qui contourne à la fois Cloudflare et le géo-verrouillage.
  // LIVE non activé : le flux direct (game.type 0) mélange les vraies affiches
  // avec des marchés « statistiques » — à qualifier séparément.
  supports: { prematch: true, live: false },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    if (live || sport !== 'football') return [];
    return listPrematch(horizonHours, sport);
  },
  // Les marchés arrivent avec la liste : aucune requête supplémentaire ici.
  async getOdds(match) {
    return maxibetFlatOdds(match.__raw?.markets || []);
  },
};
