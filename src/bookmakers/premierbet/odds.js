import { mget } from './api.js';
import { premierbetFlatOdds } from './parse.js';

function dedupeMarkets(event) {
  const raw = [];
  if (event.markets) raw.push(...event.markets);
  else if (event.marketGroups) {
    for (const g of event.marketGroups) raw.push(...(g.markets || []));
  }
  const seen = new Set();
  return raw.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
}

// En LIVE ou au re-fetch confirm noCache : force cache-buster pour éviter les cotes
// stale servies par CDN/proxy (bug user : cotes 20+ pour équipe qui mène en 2ème MT).
export async function getOdds(match, { live = false, noCache = false, sport = 'football' } = {}) {
  const forceNoCache = live || noCache;
  const event = await mget(`/events/${match.id}`, {}, 15_000, { noCache: forceNoCache });
  if (!event) return {};
  const evObj = event?.data || event;
  const markets = dedupeMarkets(evObj);
  return premierbetFlatOdds(markets, { live, sport });
}
