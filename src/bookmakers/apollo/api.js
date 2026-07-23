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
export const APOLLO_SID = { football: 388 };

export async function apolloGet(path) {
  return fetchJson(`${SPORT_API}${path}`, { headers: HEADERS, timeoutMs: 20_000 });
}
