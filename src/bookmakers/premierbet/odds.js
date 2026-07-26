// Lecture des cotes d'un match PremierBet via /rest/market/events/{id}.
import { pbGet } from './api.js';
import { premierbetFlatOdds } from './parse.js';

export async function getOdds(match) {
  const eventId = match.__raw?.eventId || match.id;
  const raw = await pbGet(`/rest/market/events/${eventId}`);
  const games = raw?.data?.games || [];
  return premierbetFlatOdds(games);
}
