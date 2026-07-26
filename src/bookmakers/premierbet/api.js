// PremierBet accès via Scrape.do (Cloudflare bloque tout direct/stealth depuis GH).
// Backend legacy `premierbetzone.com/rest` : bestsellers (list) + market/events/{id} (détail).
// Le nouveau backend `sports-api.premierbet.com/cg/v1/events/featured` a été essayé
// mais ne retourne QUE le marché 1X2 (1 market/event) — inutile pour arbitrage
// multi-marchés. On garde donc l'ancien flow avec fetch détail cap.
//
// Budget SCRAPE_DO_KEY = 1000 req/mois. Cache 60min → ~24 fetches list/jour + ~15
// details/scan × 6 scans/jour = ~114/jour × 30 = 3400/mois. Trop → on cap détails
// à 15/scan pour tenir ~30/jour = 900/mois.
const SCRAPE_DO_KEY = process.env.SCRAPE_DO_KEY || '';
const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;

export const scrapeDoConfigured = () => Boolean(SCRAPE_DO_KEY);

async function viaScrapeDo(url, { timeoutMs = 20_000, attempt = 1 } = {}) {
  if (!SCRAPE_DO_KEY) return null;
  const qs = new URLSearchParams({ token: SCRAPE_DO_KEY, url }).toString();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(`https://api.scrape.do/?${qs}`, { signal: ctrl.signal });
    const body = await res.text();
    if (!res.ok) {
      console.log(`[premierbet] scrape.do attempt=${attempt} status=${res.status} elapsed=${Date.now()-t0}ms body_start="${body.slice(0,120)}"`);
      return null;
    }
    try { return JSON.parse(body); } catch {
      console.log(`[premierbet] scrape.do attempt=${attempt} non-json len=${body.length}`);
      return null;
    }
  } catch (e) {
    console.log(`[premierbet] scrape.do attempt=${attempt} err=${e.message} elapsed=${Date.now()-t0}ms`);
    return null;
  } finally { clearTimeout(t); }
}

export async function scrapedGet(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;
  let j = await viaScrapeDo(url, { attempt: 1 });
  if (!j) {
    await new Promise((r) => setTimeout(r, 3000));
    j = await viaScrapeDo(url, { attempt: 2, timeoutMs: 25_000 });
  }
  if (j) { cache.set(url, { ts: Date.now(), data: j }); return j; }
  return null;
}

// Backend legacy RESTEasy (Editec) — flow validé bestsellers + market/events/{id}
const LEGACY_BASE = 'https://premierbetzone.com/rest';
export async function pget(path) {
  const j = await scrapedGet(`${LEGACY_BASE}/${path}`);
  return j && j.code === 200 ? j.data : null;
}

export const isVirtual = (s) => /\bcyber|esoccer|e-?soccer|virtual|simulated|\bsrl\b/i.test(s || '');
export const isOutright = (s) => /outright|winner|to win the|top scorer|qualif|advance|group [a-z] winner/i.test(s || '');
export function splitTeams(name) {
  const parts = String(name || '').split(' - ');
  if (parts.length < 2) return null;
  return { home: parts[0].trim(), away: parts.slice(1).join(' - ').trim() };
}
