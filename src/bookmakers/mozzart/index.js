import { listMozzart } from './list.js';
import { mozFetchOdds, mozSubgameIds, MOZ_SPORT_IDS } from './api.js';
import { mozzartFlatOdds } from './parse.js';

// Mozzartbet Kenya : les cotes se lisent PAR LOT (/getBettingOdds accepte une
// liste de matchs), donc getOddsBatch est la voie normale — getOdds n'existe que
// pour les lectures unitaires de controle.
// live: false — le flux public ne distingue pas l'in-play, s'en servir
// produirait de faux surebets live (meme piege que Betika).
const SPORTS = new Set(['football']);
const BATCH = 15;

// Le catalogue des sous-jeux ne bouge quasiment jamais : une lecture par
// processus suffit.
const subgamesCache = new Map();
async function subgamesFor(sport) {
  const sportId = MOZ_SPORT_IDS[sport];
  if (!subgamesCache.has(sport)) subgamesCache.set(sport, await mozSubgameIds(sportId));
  return subgamesCache.get(sport) || [];
}

export default {
  key: 'mozzart',
  label: 'Mozzartbet',
  supports: { prematch: true, live: false },
  async listMatches({ sport = 'football', live = false, horizonHours = 72 } = {}) {
    if (!SPORTS.has(sport) || live) return [];
    return listMozzart({ sport, live, horizonHours });
  },
  async getOdds(match, { sport = 'football', live = false } = {}) {
    if (!SPORTS.has(sport) || live) return {};
    const subgames = await subgamesFor(sport);
    if (!subgames.length) return {};
    const map = await mozFetchOdds([Number(match.id)], subgames);
    const kodds = map.get(String(match.id));
    return kodds ? mozzartFlatOdds(kodds) : {};
  },
  async getOddsBatch(matches, { sport = 'football', live = false } = {}) {
    const out = new Map();
    if (!SPORTS.has(sport) || live) return out;
    const subgames = await subgamesFor(sport);
    if (!subgames.length) return out;
    for (let i = 0; i < matches.length; i += BATCH) {
      const slice = matches.slice(i, i + BATCH);
      const map = await mozFetchOdds(slice.map((m) => Number(m.id)), subgames);
      for (const m of slice) {
        const kodds = map.get(String(m.id));
        if (kodds) out.set(m.id, mozzartFlatOdds(kodds));
      }
    }
    return out;
  },
};
