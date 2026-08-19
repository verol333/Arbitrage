// Apollo Games — sportapis-apollo.webapis.sk.
// L'API renvoie [] silencieusement quand l'IP source n'est pas whitelistée
// (blacklist datacenter observée 2026-08-19 : GitHub Actions + proxies publics
// tous KO). Fix : CF Worker DEDIE Apollo (deploye par le user 2026-08-19)
// qui reforward avec les headers Origin/Referer m.apollogames.cg — passe
// le filtre Apollo comme trafic navigateur legitime.
// Fallback : proxies publics gratuits + direct fetch si le CF worker principal
// est down. Rejette les reponses vides silencieuses.
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
// 391=Basketball, 398=Ice Hockey, 397=Volleyball, 417=Table Tennis.
// Table Tennis Apollo : sid=417 (confirmé F12 user 2026-08-13 Czech Liga Pro).
export const APOLLO_SID = { football: 388, tennis: 389, basket: 391, hockey: 398, volleyball: 397, table_tennis: 417 };

// CF Worker DEDIE Apollo (deploye 2026-08-19 par le user via workers.cloudflare.com).
// Fait proxy generique avec Origin/Referer m.apollogames.cg forcés.
const APOLLO_CF_WORKER = 'https://appolo.alexverol02.workers.dev';

// Proxies publics gratuits (fallback si CF worker Apollo down).
const PUBLIC_PROXIES = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
];
let pubCursor = 0;

// Considere "OK" une reponse qui contient au moins un champ Response non-vide,
// OU un objet non-vide. Reject les [] silencieux d'Apollo (soft-block).
function isValidResponse(j) {
  if (!j) return false;
  if (Array.isArray(j)) return j.length > 0;
  if (typeof j !== 'object') return false;
  return Object.keys(j).length > 0;
}

export async function apolloGet(path) {
  const url = `${SPORT_API}${path}`;

  // 1re priorite : CF Worker Apollo dedie (le worker force les headers upstream).
  const proxiedCf = `${APOLLO_CF_WORKER}/?url=${encodeURIComponent(url)}`;
  const j1 = await fetchJson(proxiedCf, { timeoutMs: 15_000 });
  if (isValidResponse(j1)) return j1;

  // 2e : cascade proxies publics gratuits.
  const start = pubCursor++ % PUBLIC_PROXIES.length;
  for (let i = 0; i < PUBLIC_PROXIES.length; i++) {
    const builder = PUBLIC_PROXIES[(start + i) % PUBLIC_PROXIES.length];
    const proxied = builder(url);
    const j = await fetchJson(proxied, { headers: HEADERS, timeoutMs: 10_000 });
    if (isValidResponse(j)) return j;
  }
  // 3e : direct fetch (peut renvoyer [] mais mieux que null).
  return fetchJson(url, { headers: HEADERS, timeoutMs: 20_000 });
}
