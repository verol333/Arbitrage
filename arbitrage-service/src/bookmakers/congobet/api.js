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

export async function congoJson(url) {
  return fetchJson(url, { headers: HEADERS, timeoutMs: 20_000 });
}
