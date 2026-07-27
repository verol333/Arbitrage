// PremierBet Congo — API mobile (sports-api.premierbet.com/cg/v1).
// L'API mobile est publique et non protegee par Cloudflare. Chemin :
//   1) fetch direct avec UA browser + logging status/body
//   2) fallback proxyFetchJson si direct KO
import { proxyFetchJson } from '../../net/fetcher.js';
import { createSemaphore, createTtlCache } from '../../net/limiter.js';

const BASE = 'https://sports-api.premierbet.com/cg/v1';
const COMMON_PARAMS = {
  country: 'CG',
  group: 'g5',
  platform: 'mobile',
  locale: 'fr',
};
// UA browser standard — l'API mobile accepte les fetch anonymes mais on evite
// tout UA custom qui pourrait declencher un rejet cote WAF.
const HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'fr-FR,fr;q=0.9',
  'user-agent': 'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  origin: 'https://sports.premierbet.com',
  referer: 'https://sports.premierbet.com/',
};

const semaphore = createSemaphore(6);
const cacheLong = createTtlCache(60 * 1000);   // listing 60s
const cacheShort = createTtlCache(15 * 1000);  // détail event 15s

function qs(extra = {}) {
  const p = new URLSearchParams({ ...COMMON_PARAMS, ...extra });
  return p.toString();
}

// Fetch direct avec status/body logging (pour comprendre si geo-block, WAF,
// rate-limit, ou reponse vide). Fallback proxy si status = 0/403/451/curl-fail.
async function directGet(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    const body = await res.text();
    return { status: res.status, body, ct: res.headers.get('content-type') || '' };
  } catch (e) {
    return { status: 0, body: '', ct: '', err: e.message || String(e) };
  } finally { clearTimeout(t); }
}

async function fetchWithLog(url, { noCache = false } = {}) {
  const short = url.replace(BASE, '');
  // 1) Direct
  const t0 = Date.now();
  const r = await directGet(url);
  const dur = Date.now() - t0;
  if (r.status === 200 && /json/i.test(r.ct)) {
    try {
      const j = JSON.parse(r.body);
      const keys = Object.keys(j).slice(0, 4).join(',');
      console.log(`[premierbet] direct OK ${short} (${dur}ms) keys=[${keys}]`);
      return j;
    } catch (e) {
      console.log(`[premierbet] direct 200 non-JSON ${short} (${dur}ms) ct=${r.ct}`);
    }
  } else {
    const snippet = (r.body || r.err || '').slice(0, 140).replace(/\s+/g, ' ');
    console.log(`[premierbet] direct KO ${short} (${dur}ms) status=${r.status} ct=${r.ct} body=${snippet}`);
  }
  // 2) Fallback proxy (utilise PROXY_MODE — si secret casse, echec silencieux mais logge)
  const t1 = Date.now();
  const j = await proxyFetchJson(url, {
    timeoutMs: 25_000,
    setHeaders: HEADERS,
    extraHeaders: HEADERS,
    noCache,
  });
  const dur2 = Date.now() - t1;
  if (!j) {
    console.log(`[premierbet] proxy fallback KO ${short} (${dur2}ms)`);
    return null;
  }
  const keys = Object.keys(j).slice(0, 4).join(',');
  console.log(`[premierbet] proxy fallback OK ${short} (${dur2}ms) keys=[${keys}]`);
  return j;
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
    const j = await fetchWithLog(url, { noCache });
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
        // Injecte compet/catégorie si l'event ne les porte pas déjà (utile pour la ligue).
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

// Cherche la ligne (handicap/total) sur un marché ou un outcome. L'API mobile
// PremierBet la porte parfois sur le market (baseValue/argument), parfois seulement
// dans le nom de l'outcome ("Plus 2.5", "1 (+1.5)").
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
  // Fallback : parse depuis les noms (marché ou outcome).
  const src = `${market?.name || ''} ${outcome?.name || ''}`;
  const m = src.match(/[-+]?\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(',', '.')) : NaN;
}

export const isOutright = (s) => /outright|winner|to win the|top scorer|qualif|advance|group [a-z] winner|vainqueur du tournoi/i.test(s || '');
export const isVirtual = (s) => /\bcyber|esoccer|e-?soccer|virtual|simulated|\bsrl\b|\bfifa\b/i.test(s || '');

// eventNames = [home, away]. On garde la logique simple mais on tolère les
// séparateurs classiques si un jour l'API renvoie un string composite.
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
