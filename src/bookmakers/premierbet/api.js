// PremierBet accès via Scrape.do (Cloudflare bloque tout direct/stealth depuis GH).
// Nouveau backend `sports-api.premierbet.com` (Editec direct) : markets INLINE = pas de fetch détail.
// Fallback ancien backend `premierbetzone.com/rest` si nouveau échoue.
// Budget SCRAPE_DO_KEY = 1000 req/mois. Cache 60min → ~24 fetches/jour = 720/mois.
const SCRAPE_DO_KEY = process.env.SCRAPE_DO_KEY || '';
const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;

export const scrapeDoConfigured = () => Boolean(SCRAPE_DO_KEY);

async function viaScrapeDo(url, timeoutMs = 30_000) {
  if (!SCRAPE_DO_KEY) return null;
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

// Fetch générique cached (nouveau backend sports-api ou ancien /rest)
export async function scrapedGet(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;
  const j = await viaScrapeDo(url);
  if (j) { cache.set(url, { ts: Date.now(), data: j }); return j; }
  return null;
}

// Ancien backend RESTEasy (legacy fallback)
const LEGACY_BASE = 'https://premierbetzone.com/rest';
export async function pget(path) {
  const j = await scrapedGet(`${LEGACY_BASE}/${path}`);
  return j && j.code === 200 ? j.data : null;
}

// Nouveau backend Editec direct : structure `{data: [{id, eventNames, startTime, markets: [{id, name, outcomes: [{name, value}]}]}]}`
const SPORTS_API_BASE = 'https://sports-api.premierbet.com';
// pageId "featured" football validé via probe (63fe10b530a2f04c64fbd643 → 20 events avec markets inline)
const FOOTBALL_FEATURED_PAGE_ID = '63fe10b530a2f04c64fbd643';

export async function fetchFeaturedFootball() {
  const url = `${SPORTS_API_BASE}/cg/v1/events/featured?country=CG&group=g5&platform=desktop&locale=fr&pageId=${FOOTBALL_FEATURED_PAGE_ID}`;
  const j = await scrapedGet(url);
  return Array.isArray(j?.data) ? j.data : [];
}

export const isVirtual = (s) => /\bcyber|esoccer|e-?soccer|virtual|simulated|\bsrl\b/i.test(s || '');
export const isOutright = (s) => /outright|winner|to win the|top scorer|qualif|advance|group [a-z] winner/i.test(s || '');
export function splitTeams(name) {
  const parts = String(name || '').split(' - ');
  if (parts.length < 2) return null;
  return { home: parts[0].trim(), away: parts.slice(1).join(' - ').trim() };
}
