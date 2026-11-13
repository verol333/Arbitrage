import { b9Event } from './api.js';
import { parseB9Odds } from './parse.js';

// Petit cache mémoire : un même match est lu plusieurs fois dans un cycle
// (appariement puis relecture de contrôle) — inutile de retaper Bet9ja.
const CACHE_TTL_MS = 60_000;
const cache = new Map();

export async function getOdds(matchId, { noCache = false } = {}) {
  const id = String(matchId);
  const hit = cache.get(id);
  if (!noCache && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.odds;
  const D = await b9Event(id, { noCache });
  const { odds } = parseB9Odds(D);
  cache.set(id, { at: Date.now(), odds });
  if (cache.size > 400) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100);
    oldest.forEach(([k]) => cache.delete(k));
  }
  return odds;
}

// Lecture complète (marchés + dictionnaire) pour la sonde de cartographie.
export async function getEventFull(matchId, { noCache = false } = {}) {
  return b9Event(matchId, { noCache });
}
