// Apollo Games — accès direct webapis.sk (pas de proxy).
import { fetchJson } from '../../net/fetcher.js';

const SPORT_API = 'https://sportapis-apollo.webapis.sk/SportsOfferApi/api';
const HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Origin: 'https://m.apollogames.cg',
  Referer: 'https://m.apollogames.cg/',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
};
// Sport IDs Apollo (via /sport/offer/v3/sports) : 388=Soccer, 389=Tennis,
// 391=Basketball, 398=Ice Hockey, 397=Volleyball.
// Volleyball Apollo : sid=397 (confirme via probe 2026-08-11 /sport/offer/v3/sports).
export const APOLLO_SID = { football: 388, tennis: 389, basket: 391, hockey: 398, volleyball: 397 };

export async function apolloGet(path) {
  return fetchJson(`${SPORT_API}${path}`, { headers: HEADERS, timeoutMs: 20_000 });
}
