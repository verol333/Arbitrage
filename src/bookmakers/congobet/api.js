// Accès Congobet (Honoré Gaming / Sporty-Tech) — port fidèle de matchCore.ts.
import { fetchJson } from '../../net/fetcher.js';

const ORIGIN = 'https://www.congobet.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
export const CONGO_API = 'https://hg-event-api-prod.sporty-tech.net/api/';
export const HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'fr-FR,fr;q=0.9',
  'user-agent': UA,
  origin: ORIGIN,
  referer: `${ORIGIN}/sports`,
};

export async function congoJson(url, { noCache = false } = {}) {
  // noCache=true (live + confirm re-fetch) : force cache-buster _t pour bypasser
  // le cache CDN/proxy (Cloudflare + Sporty-Tech) qui peut servir des cotes
  // vieilles de 30-60s. En live les cotes bougent en secondes → cotes stale =
  // fake arbs (bug potentiel sans reproduction directe, mais aligne le
  // comportement avec 1xBet/PremierBet/SportyBet qui font deja cette protection).
  const finalUrl = noCache ? `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}` : url;
  return fetchJson(finalUrl, { headers: HEADERS, timeoutMs: 20_000 });
}
