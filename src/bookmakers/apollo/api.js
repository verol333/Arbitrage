// Apollo Games — sportapis-apollo.webapis.sk.
// L'API renvoie [] silencieusement quand l'IP source n'est pas whitelistée
// (blacklist datacenter GitHub Actions/AWS/etc. observée 2026-08-19 : audit
// couverture → 0 matchs listés alors que l'app mobile marche normalement).
// Fix : cascade CF Workers privés (même pattern que xbet), fallback direct
// fetch en dernier recours. Les CF Workers présentent une IP Cloudflare
// traitée comme trafic navigateur légitime par Apollo.
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

// CF Workers privés — mêmes que xbet (réutilisation infra existante).
const CF_WORKERS = [
  'https://hidden-pine-7436.veolalex3.workers.dev',
  'https://billowing-sea-2d8e.alvecapital60.workers.dev',
];
let cfCursor = 0;

export async function apolloGet(path) {
  const url = `${SPORT_API}${path}`;
  // Cascade CF Workers (round-robin) → si tous KO, direct fetch.
  const start = cfCursor++ % CF_WORKERS.length;
  for (let i = 0; i < CF_WORKERS.length; i++) {
    const w = CF_WORKERS[(start + i) % CF_WORKERS.length];
    const proxied = `${w}/?url=${encodeURIComponent(url)}`;
    const j = await fetchJson(proxied, { headers: HEADERS, timeoutMs: 15_000 });
    // Apollo renvoie [] quand blacklisté. Un array vide OU un objet vide = échec.
    // On considère "OK" uniquement si on a un objet non-vide (au minimum { Response: [...] }).
    if (j && typeof j === 'object' && !Array.isArray(j) && Object.keys(j).length > 0) return j;
  }
  // Dernier recours : direct fetch (peut renvoyer [] mais mieux que rien).
  return fetchJson(url, { headers: HEADERS, timeoutMs: 20_000 });
}
