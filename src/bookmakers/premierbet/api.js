// PremierBet accès via Scrape.do (Cloudflare bloque tout direct/stealth depuis GH).
// Basic 1cr/req. Budget SCRAPE_DO_KEY = 1000 req/mois = ~33/jour.
// Cache TTL 5min pour économiser (un scan cron toutes les 10min → 1 fetch effectif).
import { stealthGetJson } from '../../net/stealth.js';
import { fetchJson } from '../../net/fetcher.js';

const BASE = 'https://premierbetzone.com/rest';
const SCRAPE_DO_KEY = process.env.SCRAPE_DO_KEY || '';
const cache = new Map();
// Cache 60 min : couvre 6 scans prematch cron 10-min. Sur 24h × 4h = ~6 fetches/jour
// listMatches + 15 details capped par scan = ~30 total/jour = 900/mois (sous 1000 budget).
const CACHE_TTL_MS = 60 * 60 * 1000;

export const scrapeDoConfigured = () => Boolean(SCRAPE_DO_KEY);

async function viaScrapeDo(url, timeoutMs = 45_000) {
  const qs = new URLSearchParams({ token: SCRAPE_DO_KEY, url }).toString();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.scrape.do/?${qs}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const body = await res.text();
    try { return JSON.parse(body); } catch { return null; }
  } catch { return null; } finally { clearTimeout(t); }
}

export async function pget(path) {
  const url = `${BASE}/${path}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;

  // Tier 1 : Scrape.do (bypass CF garanti si key configurée)
  if (SCRAPE_DO_KEY) {
    const j = await viaScrapeDo(url);
    if (j && j.code === 200) {
      cache.set(url, { ts: Date.now(), data: j.data });
      return j.data;
    }
  }

  // Tier 2 : stealth (rare — souvent bloqué par CF)
  const j = await stealthGetJson(url, { timeoutMs: 15_000 });
  if (j && j.code === 200) {
    cache.set(url, { ts: Date.now(), data: j.data });
    return j.data;
  }
  // Tier 3 : direct fetch (dernier recours)
  const j2 = await fetchJson(url, { timeoutMs: 20_000 });
  if (j2 && j2.code === 200) {
    cache.set(url, { ts: Date.now(), data: j2.data });
    return j2.data;
  }
  return null;
}

export const isVirtual = (s) => /\bcyber|esoccer|e-?soccer|virtual|simulated|\bsrl\b/i.test(s || '');
export const isOutright = (s) => /outright|winner|to win the|top scorer|qualif|advance|group [a-z] winner/i.test(s || '');
export function splitTeams(name) {
  const parts = String(name || '').split(' - ');
  if (parts.length < 2) return null;
  return { home: parts[0].trim(), away: parts.slice(1).join(' - ').trim() };
}
