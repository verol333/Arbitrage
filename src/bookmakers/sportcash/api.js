// Sportcash — accès direct sportcash.ci/XSportDatastore (pas de Cloudflare).
import { fetchJson } from '../../net/fetcher.js';

const BASE = 'https://sportcash.ci/XSportDatastore';
const HDR = {
  'user-agent': 'Mozilla/5.0',
  accept: 'application/json, text/plain, */*',
  referer: 'https://sportcash.ci/',
};
const COMMON = { systemCode: 'SPORTCASH', lingua: 'FR', hash: '' };

export async function xget(endpoint, params, timeoutMs = 20_000) {
  const qs = new URLSearchParams({ ...COMMON, ...params }).toString();
  return fetchJson(`${BASE}/${endpoint}?${qs}`, { headers: HDR, timeoutMs });
}

// "20260726 15:00:00" → ms epoch UTC.
// Sportcash retourne l'heure en UTC (Abidjan/GMT). Aucun décalage à appliquer.
// (Debug SC vs 1xBet a confirmé decalage +60min systematique quand on soustrayait
// 1h - c'etait un bug historique.)
export function parseTs(ts) {
  const m = String(ts || '').match(/^(\d{4})(\d{2})(\d{2})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi);
}

export function splitTeams(da) {
  const parts = String(da || '').split(' - ');
  if (parts.length < 2) return null;
  return { home: parts[0].trim(), away: parts.slice(1).join(' - ').trim() };
}

export const isVirtual = (s) => /\bcyber|esoccer|e-?soccer|virtual|simulated|\bsrl\b|\bfifa\b/i.test(s || '');
