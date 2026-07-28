import { listMatches } from './list.js';
import { betmomoFlatOdds } from './parse.js';
import { swarmSession } from './api.js';

// Re-fetch FRAIS des markets pour une liste de match IDs. Utilise pour
// confirmation LIVE : les markets caches dans match.__raw (poses par
// listMatches) peuvent avoir 15+ secondes de retard — critique quand un
// but vient d'etre marque et les cotes ont bouge (source des alertes
// "cotes anciennes envoyees comme fraiches").
async function fetchFreshMarkets(ids) {
  if (!ids.length) return new Map();
  return swarmSession(async (send) => {
    const out = new Map();
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      const od = await send(
        { game: ['id'], market: ['name', 'type', 'col_count', 'group_name', 'group_id'], event: ['name', 'price', 'base', 'type_1', 'type'] },
        { game: { id: { '@in': chunk } } },
      );
      for (const g of Object.values(od?.game || {})) {
        out.set(String(g.id), Object.values(g.market || {}));
      }
    }
    return out;
  }, { timeoutMs: 20_000 }).catch(() => new Map());
}

export default {
  key: 'betmomo',
  label: 'BetMomo',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    return listMatches({ live, horizonHours, sport });
  },
  async getOdds(match, { noCache = false } = {}) {
    if (noCache && match.id != null) {
      const fresh = await fetchFreshMarkets([String(match.id)]);
      const mk = fresh.get(String(match.id));
      if (mk) return betmomoFlatOdds(mk);
    }
    return betmomoFlatOdds(match.__raw?.markets || []);
  },
  async getOddsBatch(matches, { noCache = false } = {}) {
    const out = new Map();
    if (noCache && matches.length) {
      const ids = matches.map((m) => String(m.id));
      const fresh = await fetchFreshMarkets(ids);
      for (const m of matches) {
        const mk = fresh.get(String(m.id));
        out.set(m.id, betmomoFlatOdds(mk || m.__raw?.markets || []));
      }
      return out;
    }
    for (const m of matches) out.set(m.id, betmomoFlatOdds(m.__raw?.markets || []));
    return out;
  },
};
