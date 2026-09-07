import { listBetika } from './list.js';
import { btkFetchMatch, btkFetchLiveMatch } from './api.js';
import { betikaFlatOdds } from './parse.js';
import { betikaTennisFlatOdds } from './parseTennis.js';

// Betika : les cotes completes ne sont disponibles que par match (/v1/uo/match),
// donc getOdds refait toujours une lecture fraiche a chaque cycle.
// Live : flux in-play reel sur live-cd.betika.com, football uniquement
// (le flux tennis live n'a pas encore ete verifie, voir list.js).
// Sports lus : football (sport_id 3) et tennis (sport_id 1).
const SPORTS = new Set(['football', 'tennis']);

export default {
  key: 'betika',
  label: 'Betika',
  // live: true depuis le 2026-09-07 — flux in-play reel sur live-cd.betika.com
  // (football uniquement pour l'instant).
  supports: { prematch: true, live: true },
  async listMatches({ sport = 'football', live = false, horizonHours = 72 } = {}) {
    if (!SPORTS.has(sport)) return [];
    if (live && sport !== 'football') return [];
    return listBetika({ sport, live, horizonHours });
  },
  async getOdds(match, { sport = 'football', live = false } = {}) {
    if (!SPORTS.has(sport)) return {};
    if (live && sport !== 'football') return {};
    const root = live ? await btkFetchLiveMatch(match.id) : await btkFetchMatch(match.id);
    const markets = Array.isArray(root?.data) ? root.data : [];
    if (!markets.length) return {};
    const odds = sport === 'tennis' ? betikaTennisFlatOdds(markets) : betikaFlatOdds(markets, { sport });
    // Le code coupon Betika se genere depuis (parent_match_id, outcome_id).
    for (const meta of Object.values(odds._ids || {})) meta.match_id = String(match.id);
    return odds;
  },
};
