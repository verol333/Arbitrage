import { listPrematch, listLive } from './list.js';
import { getOdds as getOddsImpl } from './odds.js';

export default {
  key: '1xbet',
  label: '1xbet',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, sport = 'football' } = {}) {
    if (!['football', 'tennis', 'basket', 'hockey', 'volleyball', 'table_tennis'].includes(sport)) return [];
    return live ? listLive({ sport }) : listPrematch({ sport });
  },
  async getOdds(match, { live = false, noCache = false, sport = 'football' } = {}) {
    const p = getOddsImpl(match.id, { live, noCache, sport });
    if (!live) return p;
    // Live : 8 s max par match. Un match en retard est relu au tour suivant
    // au lieu de bloquer tout le tour (relais publics lents = jusqu'a 30 s).
    let t;
    return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(null), 8_000); })]).finally(() => clearTimeout(t));
  },
};
