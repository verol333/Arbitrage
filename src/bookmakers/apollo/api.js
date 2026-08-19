// Apollo Games — sportapis-apollo.webapis.sk.
// L'API renvoie [] silencieusement quand l'IP source n'est pas whitelistée
// (blacklist datacenter GitHub Actions observée 2026-08-19 : audit couverture
// → 0 matchs listés alors que l'app mobile marche normalement).
// Fix : cascade proxies publics gratuits (memes que xbet). Le premier qui
// renvoie une reponse non-vide gagne. Direct fetch en dernier recours.
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

// Proxies gratuits (memes que xbet). Cascade jusqu'a ce qu'un renvoie du contenu.
// - allorigins.win : très fiable, cache 5min côté serveur
// - codetabs.com/v1/proxy : maintenu, gratuit
// - corsproxy.io : rapide, illimité, gratuit
// - thingproxy.freeboard.io : legacy mais stable
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
  // Cascade proxies publics (round-robin) → premier qui renvoie du contenu gagne.
  const start = pubCursor++ % PUBLIC_PROXIES.length;
  for (let i = 0; i < PUBLIC_PROXIES.length; i++) {
    const builder = PUBLIC_PROXIES[(start + i) % PUBLIC_PROXIES.length];
    const proxied = builder(url);
    const j = await fetchJson(proxied, { headers: HEADERS, timeoutMs: 12_000 });
    if (isValidResponse(j)) return j;
  }
  // Dernier recours : direct fetch (peut renvoyer [] mais mieux que null).
  return fetchJson(url, { headers: HEADERS, timeoutMs: 20_000 });
}
