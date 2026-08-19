// Apollo Games — sportapis-apollo.webapis.sk.
// L'API renvoie [] silencieusement quand l'IP source n'est pas whitelistée
// (blacklist datacenter GitHub Actions/AWS/etc. observée 2026-08-19 : audit
// couverture → 0 matchs listés alors que l'app mobile marche normalement).
// Fallback : on route via CF Worker (proxy déjà utilisé pour BetPawa),
// qui présente une IP Cloudflare traitée comme trafic navigateur légitime.
// Fetch direct conservé en fallback si CF_WORKER_PROXY_URL absent.
import { fetchJson } from '../../net/fetcher.js';
import { proxyFetchJson } from '../../net/fetcher.js';
import { config } from '../../config.js';

const SPORT_API = 'https://sportapis-apollo.webapis.sk/SportsOfferApi/api';
const HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Origin: 'https://m.apollogames.cg',
  Referer: 'https://m.apollogames.cg/',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
};
// Sport IDs Apollo (via /sport/offer/v3/sports) : 388=Soccer, 389=Tennis,
// 391=Basketball, 398=Ice Hockey, 397=Volleyball, 417=Table Tennis.
// Table Tennis Apollo : sid=417 (confirmé F12 user 2026-08-13 Czech Liga Pro).
export const APOLLO_SID = { football: 388, tennis: 389, basket: 391, hockey: 398, volleyball: 397, table_tennis: 417 };

export async function apolloGet(path) {
  const url = `${SPORT_API}${path}`;
  // Priorite CF Worker si configure : l'IP Cloudflare passe le filtre Apollo.
  // Fallback direct fetch sinon (peut retourner [] mais au moins ne casse pas
  // les envs qui n'ont pas de proxy).
  if (config.proxy.cfworkerUrl) {
    return proxyFetchJson(url, {
      mode: 'cfworker',
      setHeaders: HEADERS,
      timeoutMs: 20_000,
    });
  }
  return fetchJson(url, { headers: HEADERS, timeoutMs: 20_000 });
}
