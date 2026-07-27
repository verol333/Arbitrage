// PremierBet Congo — API mobile (sports-api.premierbet.com/cg/v1).
// L'API mobile marche depuis une IP residentielle (le script Python de
// l'utilisateur passe sans probleme), mais Cloudflare bloque les IPs
// datacenter GitHub Actions. Solution : routage via les CF Workers de
// l'utilisateur (memes URLs que 1xBet — deja deployes, gratuits, 100k
// req/jour chacun). Round-robin pour repartir la charge.
import { fetchJson } from '../../net/fetcher.js';
import { createSemaphore, createTtlCache } from '../../net/limiter.js';

// Deux CF Workers deployes sur les comptes CF de l'utilisateur (memes que
// ceux utilises par le connecteur 1xBet). Chacun accepte /?url=<encoded>
// et proxy le GET depuis l'infra Cloudflare → IP acceptee par le WAF
// PremierBet. Duplication volontaire : chaque dossier bookmaker doit
// rester autonome (regle du repo).
const CF_WORKERS = [
  'https://hidden-pine-7436.veolalex3.workers.dev',
  'https://billowing-sea-2d8e.alvecapital60.workers.dev',
];
let cfCursor = 0;
function orderedWorkers() {
  const start = cfCursor++ % CF_WORKERS.length;
  return CF_WORKERS.map((_, i) => CF_WORKERS[(start + i) % CF_WORKERS.length]);
}

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

// Fetch via CF Workers en round-robin. On essaye chaque worker jusqu'a
// obtenir une reponse. Log OK/KO explicite pour diag.
async function fetchWithLog(url) {
  const short = url.replace(BASE, '');
  const t0 = Date.now();
  for (const w of orderedWorkers()) {
    const j = await fetchJson(`${w}/?url=${encodeURIComponent(url)}`, {
      timeoutMs: 20_000,
    });
    if (j) {
      const dur = Date.now() - t0;
      const keys = Object.keys(j).slice(0, 4).join(',');
      const workerHost = w.replace(/^https?:\/\//, '').slice(0, 20);
      console.log(`[premierbet] OK ${short} via ${workerHost} (${dur}ms) keys=[${keys}]`);
      return j;
    }
  }
  console.log(`[premierbet] KO ${short} (${Date.now() - t0}ms) — tous workers KO`);
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
