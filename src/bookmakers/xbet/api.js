// Accès 1xbet via BATTERIE de proxies gratuits en cascade (first-wins).
// Aucun proxy privilégié : celui qui répond en premier gagne. Log stats.
// Ordre : (1) CF workers privés, (2) direct fetch, (3-6) proxies publics CORS
// gratuits (rotation pour ne pas taper toujours le même).
import { fetchJson } from '../../net/fetcher.js';

export const FEED = 'https://1xbet.cg';
export const COUNTRY = 93;
export const PARTNER = 192;

const CF_WORKERS = [
  'https://hidden-pine-7436.veolalex3.workers.dev',
  'https://billowing-sea-2d8e.alvecapital60.workers.dev',
];

// Proxies CORS gratuits, tous testés opérationnels et sans clé API :
// - allorigins.win : très fiable, cache 5min côté serveur
// - codetabs.com/v1/proxy : maintenu, gratuit
// - corsproxy.io : rapide, illimité, gratuit
// - thingproxy.freeboard.io : legacy mais stable
// - corsanywhere.com : demo mais tolère notre volume
const PUBLIC_PROXIES = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
];

const HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'fr-FR,fr;q=0.9',
  'content-type': 'application/json',
  origin: FEED,
  referer: `${FEED}/en/line`,
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'x-requested-with': 'XMLHttpRequest',
};

// Stats globales pour visibilité
const stats = { cf: 0, direct: 0, pub: 0, fail: 0, byPub: [0, 0, 0, 0] };

async function tryFetch(url, timeoutMs) {
  try {
    return await fetchJson(url, { headers: HEADERS, timeoutMs });
  } catch { return null; }
}

// Cursor round-robin pour spread la charge sur CF workers + proxies publics
let cfCursor = 0, pubCursor = 0;
function cfWorkers() {
  const start = cfCursor++ % CF_WORKERS.length;
  return CF_WORKERS.map((_, i) => CF_WORKERS[(start + i) % CF_WORKERS.length]);
}
function publicProxies() {
  const start = pubCursor++ % PUBLIC_PROXIES.length;
  return PUBLIC_PROXIES.map((_, i) => ({ builder: PUBLIC_PROXIES[(start + i) % PUBLIC_PROXIES.length], idx: (start + i) % PUBLIC_PROXIES.length }));
}

// Batterie cascade : chaque strategy essaie 1 fois avec timeout court.
// Total worst case : 2 CF × 5s + 1 direct × 5s + 4 pub × 8s = 47s max.
// Best case : 1re CF répond en <2s.
// noCache=true : ajoute cache-buster _t sur URL + skip allorigins.win (cache 5min
// côté serveur, produit des cotes stale en live). CF+direct+3 proxies restants.
export async function viaWorker(url, { noCache = false } = {}) {
  const targetUrl = noCache ? `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}` : url;
  // 1. CF workers privés (round-robin)
  for (const w of cfWorkers()) {
    const j = await tryFetch(`${w}/?url=${encodeURIComponent(targetUrl)}`, 5_000);
    if (j) { stats.cf++; return j; }
  }
  // 2. Direct fetch (peut marcher si 1xBet.cg ne bloque pas notre IP)
  const j = await tryFetch(targetUrl, 5_000);
  if (j) { stats.direct++; return j; }
  // 3. Proxies CORS publics (round-robin) — skip allorigins.win si noCache (cache 5min).
  for (const { builder, idx } of publicProxies()) {
    if (noCache && idx === 0) continue; // idx 0 = allorigins.win
    const j2 = await tryFetch(builder(targetUrl), 8_000);
    if (j2) { stats.pub++; stats.byPub[idx]++; return j2; }
  }
  stats.fail++;
  if (stats.fail % 20 === 0) {
    console.log(`[xbet] proxy stats — cf=${stats.cf} direct=${stats.direct} pub=${stats.pub}(${stats.byPub.join('/')}) fail=${stats.fail}`);
  }
  return null;
}

export function isFakeTeam(name) {
  const n = (name || '').trim();
  return /à domicile|à l'extérieur|a domicile|a l'exterieur|home team|away team|player|joueur/i.test(n)
    || /^home$/i.test(n) || /^away$/i.test(n);
}

export function isVirtual(home, away, league) {
  const s = `${home} ${away} ${league}`.toLowerCase();
  return /\bsrl\b|simulated|\besoccer\b|e-?soccer|\bcyber\b|\bvirtual\b|\besports?\b|\bfifa\b|\bpes\b|\be-?fighting\b|\be-?basketball\b|\be-?hockey\b|\be-?tennis\b/i.test(s);
}

export function mapXItems(items) {
  return (items || []).map((m) => ({
    id: m.I, home: m.O1, away: m.O2, league: m.LE || m.L || '',
    start: m.S ? m.S * 1000 : null,
  })).filter((m) => m.id && m.home && m.away && !isFakeTeam(m.home) && !isFakeTeam(m.away) && !isVirtual(m.home, m.away, m.league));
}
