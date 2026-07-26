// Lecture cotes PremierBet. Deux chemins :
//  1) Match déjà avec eventGames inline dans __raw.markets → parse direct (0 crédit)
//  2) Sinon fetch /rest/market/events/{id} via Scrape.do → parse (1 crédit)
// Budget-safe : cap global 15 fetches détails par scan pour tenir 1000cr/mois.
import { pget } from './api.js';
import { premierbetFlatOdds } from './parse.js';

const MAX_DETAIL_FETCHES_PER_SCAN = 15;
let detailFetchesThisScan = 0;
const scanResetInterval = 60 * 1000; // reset counter every minute
setInterval(() => { detailFetchesThisScan = 0; }, scanResetInterval).unref?.();

export async function getOdds(match) {
  const inline = match.__raw?.markets || [];
  if (inline.length) return premierbetFlatOdds(inline);
  // Pas de markets inline → détail nécessaire
  if (detailFetchesThisScan >= MAX_DETAIL_FETCHES_PER_SCAN) return {};
  detailFetchesThisScan++;
  const eventId = match.id;
  const data = await pget(`market/events/${eventId}`);
  const games = data?.games || data?.eventGames || [];
  return premierbetFlatOdds(games);
}
