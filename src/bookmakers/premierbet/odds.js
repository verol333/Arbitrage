// Lecture des cotes d'un event PremierBet Congo (API mobile).
// Chemin unique : GET /events/{id} → tous les marchés dédoublonnés → cotes plates.
// L'API mobile est publique et rapide → pas de budget à respecter, on peut
// paralléliser sans compter.
import { pbGet, extractMarkets } from './api.js';
import { premierbetFlatOdds } from './parse.js';

export async function getOdds(match, { live = false } = {}) {
  // Optimisation : si listLive a déjà renvoyé les markets inline, on parse direct.
  const inline = match?.__raw?.markets || match?.__raw?.marketGroups;
  if (inline && (Array.isArray(inline) ? inline.length : Object.keys(inline).length)) {
    const evLike = { markets: match.__raw.markets, marketGroups: match.__raw.marketGroups };
    const markets = extractMarkets(evLike);
    if (markets.length) return premierbetFlatOdds(markets);
  }
  const data = await pbGet(`/events/${match.id}`, {}, { long: false, noCache: live });
  const event = data?.data || data || null;
  const markets = extractMarkets(event);
  return premierbetFlatOdds(markets);
}
