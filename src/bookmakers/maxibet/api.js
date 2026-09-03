// Requêtes Swarm typées pour MaxiBet.
// Lecture OBLIGATOIREMENT en deux phases : une requête globale sur tout le sport
// est tronquée par le serveur (245 matchs au lieu de 1029, La Liga absente).
// On inventorie donc les compétitions d'abord, puis on lit les matchs par lots.
import { swarmSession, TYPE_PREMATCH } from './ws.js';

const SPORT_IDS = { football: 1 };

export function sportId(sport) {
  return SPORT_IDS[sport] || null;
}

// Phase 1 — inventaire léger des compétitions (jamais tronqué).
export async function fetchCompetitions(sport) {
  const id = sportId(sport);
  if (!id) return [];
  const res = await swarmSession([{
    rid: 'comps',
    params: {
      source: 'betting',
      what: { region: ['id', 'name'], competition: ['id', 'name'], game: '@count' },
      where: { sport: { id }, game: { type: TYPE_PREMATCH } },
    },
  }]);
  const out = [];
  const regions = res.comps?.region || {};
  for (const rKey of Object.keys(regions)) {
    const r = regions[rKey];
    for (const cKey of Object.keys(r.competition || {})) {
      const c = r.competition[cKey];
      if ((c.game || 0) > 0) out.push({ id: c.id, name: String(c.name || '').trim(), region: String(r.name || '').trim() });
    }
  }
  return out;
}

// Phase 2 — matchs + TOUS leurs marchés, par lots de compétitions.
export async function fetchGames(sport, compIds, { batchSize = 20 } = {}) {
  const id = sportId(sport);
  if (!id || !compIds.length) return [];
  const steps = [];
  for (let i = 0; i < compIds.length; i += batchSize) {
    steps.push({
      rid: 'g' + i,
      params: {
        source: 'betting',
        what: {
          competition: ['id', 'name'],
          game: ['id', 'team1_name', 'team2_name', 'start_ts'],
          market: ['id', 'name', 'type'],
          event: ['id', 'name', 'price', 'type_1', 'base'],
        },
        where: { sport: { id }, game: { type: TYPE_PREMATCH }, competition: { id: { '@in': compIds.slice(i, i + batchSize) } } },
      },
    });
  }
  const res = await swarmSession(steps);
  const rows = [];
  for (const rid of Object.keys(res)) {
    const comps = res[rid]?.competition || {};
    for (const cKey of Object.keys(comps)) {
      const comp = comps[cKey];
      for (const gKey of Object.keys(comp.game || {})) {
        const g = comp.game[gKey];
        rows.push({ comp, game: g, markets: Object.values(g.market || {}) });
      }
    }
  }
  return rows;
}
