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

export async function getOdds(match) {
  const event = await mget(`/events/${match.id}`);
  if (!event) return {};
  const markets = dedupeMarkets(event);
  return premierbetFlatOdds(markets);
}
