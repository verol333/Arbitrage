import { listMatches } from './list.js';
import { getOdds as getOddsImpl } from './odds.js';

// BetPawa Congo — API protobuf (cg.betpawa.com) via CF Worker dédié.
// Le site est protégé par Cloudflare ; le Worker contourne en appelant
// depuis les IPs Cloudflare (non bloquées) et parse le protobuf en JSON.
export default {
  key: 'betpawa',
  label: 'BetPawa',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    if (sport !== 'football') return [];
    return listMatches({ live, horizonHours });
  },
  async getOdds(match) { return getOddsImpl(match); },
};
