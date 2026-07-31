// PremierBet via Guineegames — API EDITEC (sports-api.guineegames.com/v1).
// Le premierbet.com direct est bloque par Cloudflare au niveau IP GH Actions.
// Guineegames est une marque soeur EDITEC utilisant EXACTEMENT LE MEME BACKEND
// (plateforme "sahara.editec-online.com") donc EXACTEMENT LES MEMES COTES que
// PremierBet. User a verifie via F12 network inspection.
// L'endpoint retrouve : GET /v1/events/{id}?country=GN&group=g6&platform=desktop
//
// Comme le backend est identique, on labelle les cotes comme "premierbet" dans
// l'engine d'arbitrage — c'est ce que l'user veut afficher dans son app.
import { createSemaphore, createTtlCache } from '../../net/limiter.js';

const BASE = 'https://sports-api.guineegames.com/v1';
const COMMON_PARAMS = {
  country: 'GN',
  group: 'g6',
  platform: 'desktop',
  locale: 'fr',
};
// Le Python de reference n'envoie AUCUN header custom ; on garde le meme
// comportement (Node fetch envoie ses defauts : accept-encoding, host).
const HEADERS = { accept: 'application/json' };

const semaphore = createSemaphore(6);
const cacheLong = createTtlCache(60 * 1000);   // listings 60s
const cacheShort = createTtlCache(15 * 1000);  // detail event 15s

function qs(extra = {}) {
  const p = new URLSearchParams({ ...COMMON_PARAMS, ...extra });
  return p.toString();
}

// Log structure : URL, methode, status, taille (octets), duree (ms),
// cles JSON de premier niveau. Aucun body, header, ou identifiant.
function logResult({ path, params, status, size, dur, jsonKeys, snippet }) {
  const keys = jsonKeys ? `keys=[${jsonKeys.slice(0, 4).join(',')}]` : '';
  const err = snippet ? `body=${snippet.slice(0, 80).replace(/\s+/g, ' ')}` : '';
  console.log(`[premierbet] GET ${path}?${params} status=${status} size=${size}b dur=${dur}ms ${keys}${err}`);
}

// Headers navigateur pour paraitre venant de guineegames.com (le meme
// front-end qui fait ces calls). Sans ces headers l'API renvoie 403.
async function httpGet(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        ...HEADERS,
        origin: 'https://www.guineegames.com',
        referer: 'https://www.guineegames.com/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
        'accept-language': 'fr-FR,fr;q=0.9',
      },
      signal: ctrl.signal,
    });
    const body = await res.text();
    return { status: res.status, body, dur: Date.now() - t0 };
  } catch (e) {
    return { status: 0, body: '', dur: Date.now() - t0, err: e.message || String(e) };
  } finally { clearTimeout(t); }
}

// GET JSON avec cache. `long=true` → TTL 60s (listings), sinon 15s (details).
export async function pbGet(path, extra = {}, { long = false, noCache = false } = {}) {
  const params = qs(extra);
  const url = `${BASE}${path}?${params}`;
  const cache = long ? cacheLong : cacheShort;
  if (!noCache) {
    const hit = cache.get(url);
    if (hit !== undefined) return hit;
  }
  return semaphore(async () => {
    const r = await httpGet(url);
    const size = r.body.length;
    if (r.status === 200) {
      try {
        const j = JSON.parse(r.body);
        logResult({ path, params, status: 200, size, dur: r.dur, jsonKeys: Object.keys(j) });
        if (!noCache) cache.set(url, j);
        return j;
      } catch {
        logResult({ path, params, status: 200, size, dur: r.dur, snippet: r.body });
        return null;
      }
    }
    logResult({ path, params, status: r.status || '0', size, dur: r.dur, snippet: r.body || r.err });
    return null;
  });
}

// Formats de reponse :
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

// Dedoublonne les marches d'un event : un market peut apparaitre dans plusieurs
// marketGroups. On garde la premiere occurrence par id.
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

// Cherche la ligne (handicap/total) sur un marche ou un outcome.
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
export { isVirtualText as isVirtual } from '../../core/text.js';

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
