// Lecture cotes PremierBet — 2 chemins :
//  1) Markets inline dans __raw.markets (rare depuis bestsellers) → parse direct 0 cr
//  2) Sinon fetch /rest/market/events/{id} via Scrape.do → parse (1 cr)
// Cap global 15 fetches détails par scan pour tenir budget 1000cr/mois.
import { pget } from './api.js';
import { premierbetFlatOdds } from './parse.js';

const MAX_DETAIL_FETCHES_PER_SCAN = 15;
let detailFetchesThisScan = 0;
const scanResetInterval = 60 * 1000;
setInterval(() => { detailFetchesThisScan = 0; }, scanResetInterval).unref?.();

export async function getOdds(match) {
  const inline = match.__raw?.markets || [];
  if (inline.length) return premierbetFlatOdds(inline);
  if (detailFetchesThisScan >= MAX_DETAIL_FETCHES_PER_SCAN) return {};
  detailFetchesThisScan++;
  const eventId = match.id;
  const data = await pget(`market/events/${eventId}`);
  const games = data?.games || data?.eventGames || [];
  return premierbetFlatOdds(games);
}
