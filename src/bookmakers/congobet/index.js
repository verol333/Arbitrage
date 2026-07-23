import { listPrematch, listLive } from './list.js';
import { getOdds as getOddsImpl } from './odds.js';

export default {
  key: 'congobet',
  label: 'Congobet',
  supports: { prematch: true, live: true },
  async listMatches({ live = false } = {}) { return live ? listLive() : listPrematch(); },
  async getOdds(match) { return getOddsImpl(match.id); },
};
