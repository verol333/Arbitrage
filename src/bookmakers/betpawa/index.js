import { listMatches } from './list.js';
import { betpawaFlatOdds } from './parse.js';

// BetPawa DÉSACTIVÉ temporairement (2026-08-01) :
// L'API cg.betpawa.com filtre les cotes pour les IPs GitHub Actions (anti-scraping).
// La réponse protobuf contient bien les matchs (500 UPCOMING + 72 LIVE extraits)
// mais SANS les cotes IEEE-754 dans le buffer. Le Worker CF de l'utilisateur
// contourne ce filtre via un cookie __cf_bm valide, mais le Worker actuel
// n'expose pas non plus les cotes dans son output JSON.
// À réactiver quand : (a) l'utilisateur met à jour son Worker pour inclure
// odds:[h,x,a], OU (b) on a un moyen de récupérer un cookie CF valide.
export default {
  key: 'betpawa',
  label: 'BetPawa',
  supports: { prematch: false, live: false },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    if (sport !== 'football') return [];
    return listMatches({ live, horizonHours });
  },
  async getOdds(match) {
    return betpawaFlatOdds(match);
  },
};
