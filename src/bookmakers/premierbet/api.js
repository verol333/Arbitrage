// PremierBet Congo — API mobile (sports-api.premierbet.com/cg/v1).
// Port fidele du script Python de l'utilisateur : requests.Session() sur
// /cg/v1 avec {country=CG, group=g5, platform=mobile, locale=fr}, sans
// header custom. Marche depuis son PC.
import { fetchJson } from '../../net/fetcher.js';
import { createSemaphore, createTtlCache } from '../../net/limiter.js';

const BASE = 'https://sports-api.premierbet.com/cg/v1';
const COMMON_PARAMS = {
  country: 'CG',
  group: 'g5',
  platform: 'mobile',
  locale: 'fr',
};

const semaphore = createSemaphore(6);
const cacheLong = createTtlCache(60 * 1000);   // listings 60s
const cacheShort = createTtlCache(15 * 1000);  // detail event 15s

function qs(extra = {}) {
  const p = new URLSearchParams({ ...COMMON_PARAMS, ...extra });
  return p.toString();
}

// Fetch direct comme le script Python (aucun header, comportement natif).
// Log status/body si != 200 pour diagnostiquer geo-block vs autre chose.
async function directGet(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const body = await res.text();
    return { status: res.status, body, ct: res.headers.get('content-type') || '' };
  } catch (e) {
    return { status: 0, body: '', ct: '', err: e.message || String(e) };
  } finally { clearTimeout(t); }
}

async function fetchWithLog(url) {
  const short = url.replace(BASE, '');
  const t0 = Date.now();
  const r = await directGet(url);
  const dur = Date.now() - t0;
  if (r.status === 200) {
    try {
      const j = JSON.parse(r.body);
      const keys = Object.keys(j).slice(0, 4).join(',');
      console.log(`[premierbet] OK ${short} (${dur}ms) keys=[${keys}]`);
      return j;
    } catch {
      console.log(`[premierbet] 200 non-JSON ${short} (${dur}ms) ct=${r.ct}`);
      return null;
    }
  }
  const snippet = (r.body || r.err || '').slice(0, 120).replace(/\s+/g, ' ');
  console.log(`[premierbet] KO ${short} (${dur}ms) status=${r.status} ct=${r.ct} body=${snippet}`);
  return null;
}

// GET JSON avec cache. `long=true` → TTL 60s (listings), sinon 15s (détails).
export async function pbGet(path, extra = {}, { long = false, noCache = false } = {}) {
  const url = `${BASE}${path}?${qs(extra)}`;
  const cache = long ? cacheLong : cacheShort;
  if (!noCache) {
    const hit = cache.get(url);
    if (hit !== undefined) return hit;
  }
  return semaphore(async () => {
    const j = await fetchWithLog(url);
    if (j && !noCache) cache.set(url, j);
    return j;
  });
}

// Formats de réponse :
//   featured/live/highlights → data = array plat d'events
//   upcoming                 → data.categories[].competitions[].events[]
export function extractEvents(result) {
  if (!result || result.data == null) return [];
  const data = result.data;
  if (Array.isArray(data)) return data;
  const out = [];
  for (const category of data.categories || []) {
    for (const competition of category.competitions || []) {
      for (const ev of competition.events || []) {
        if (!ev.competitionName && competition.name) ev.competitionName = competition.name;
        if (!ev.categoryName && category.name) ev.categoryName = category.name;
        out.push(ev);
      }
    }
  }
  return out;
}

// Dédoublonne les marchés d'un event : un market peut apparaître dans plusieurs
// marketGroups (Principal, Buts, etc.). On garde la première occurrence par id.
export function extractMarkets(event) {
  const raw = [];
  if (Array.isArray(event?.markets)) raw.push(...event.markets);
  if (Array.isArray(event?.marketGroups)) {
    for (const g of event.marketGroups) {
      for (const m of (g.markets || [])) raw.push(m);
    }
  }
  const seen = new Set();
  const out = [];
  for (const m of raw) {
    const id = m?.id;
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    out.push(m);
  }
  return out;
}

// Cherche la ligne (handicap/total) sur un marché ou un outcome.
export function extractLine(market, outcome = null) {
  const candidates = [
    market?.baseValue, market?.base, market?.argument, market?.line,
    market?.handicap, market?.specifier, market?.value,
    outcome?.baseValue, outcome?.base, outcome?.line, outcome?.handicap,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  const src = `${market?.name || ''} ${outcome?.name || ''}`;
  const m = src.match(/[-+]?\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(',', '.')) : NaN;
}

export const isOutright = (s) => /outright|winner|to win the|top scorer|qualif|advance|group [a-z] winner|vainqueur du tournoi/i.test(s || '');
export const isVirtual = (s) => /\bcyber|esoccer|e-?soccer|virtual|simulated|\bsrl\b|\bfifa\b/i.test(s || '');

// eventNames = [home, away] dans l'API mobile.
export function splitTeams(event) {
  const arr = event?.eventNames;
  if (Array.isArray(arr) && arr.length >= 2) {
    return { home: String(arr[0]).trim(), away: String(arr[arr.length - 1]).trim() };
  }
  const raw = event?.name || event?.eventName || '';
  const parts = String(raw).split(/ - | vs | v /i);
  if (parts.length < 2) return null;
  return { home: parts[0].trim(), away: parts.slice(1).join(' - ').trim() };
}

export function leagueOf(event) {
  const parts = [event?.categoryName, event?.competitionName].filter(Boolean);
  return parts.join(' - ');
}
