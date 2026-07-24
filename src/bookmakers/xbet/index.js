import { listPrematch, listLive } from './list.js';
import { getOdds as getOddsImpl } from './odds.js';

export default {
  key: '1xbet',
  label: '1xbet',
  supports: { prematch: true, live: true },
  async listMatches({ live = false } = {}) {
    return live ? listLive() : listPrematch();
  },
  async getOdds(match, { live = false } = {}) {
    return getOddsImpl(match.id, { live });
  },
};
