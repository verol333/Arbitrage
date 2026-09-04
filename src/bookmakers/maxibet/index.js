import { listPrematch, listLive } from './list.js';
import { maxibetFlatOdds } from './parse.js';
import { maxibetTennisFlatOdds } from './parseTennis.js';
import { maxibetHockeyFlatOdds } from './parseHockey.js';
import { maxibetBasketFlatOdds } from './parseBasket.js';

export default {
  key: 'maxibet',
  label: 'MaxiBet',
  // Skin BetConstruct (site_id 1870852) : les cotes passent par le WebSocket
  // Swarm, ce qui contourne à la fois Cloudflare et le géo-verrouillage.
  // DIRECT activé : game.type 1 expose les vraies affiches en cours avec les
  // mêmes codes de marchés que le pré-match (donc le même décodeur). Les
  // compétitions simulées « Betual » sont écartées en amont.
  // Sports lus : foot, tennis, hockey, basket (volleyball/table tennis à venir).
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    if (sport !== 'football' && sport !== 'tennis' && sport !== 'hockey' && sport !== 'basket') return [];
    return live ? listLive(sport) : listPrematch(horizonHours, sport);
  },
  // Les marchés arrivent avec la liste : aucune requête supplémentaire ici.
  async getOdds(match, { sport = 'football' } = {}) {
    if (sport !== 'football' && sport !== 'tennis' && sport !== 'hockey' && sport !== 'basket') return {};
    const markets = match.__raw?.markets || [];
    if (sport === 'tennis') return maxibetTennisFlatOdds(markets);
    if (sport === 'hockey') return maxibetHockeyFlatOdds(markets);
    if (sport === 'basket') return maxibetBasketFlatOdds(markets);
    return maxibetFlatOdds(markets);
  },
};
