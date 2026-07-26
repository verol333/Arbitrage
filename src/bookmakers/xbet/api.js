// Accès 1xbet via CF workers en round-robin. Pas de fallback stealth :
// 1xBet refuse les connexions HTTP/2 directes (NGHTTP2_REFUSED_STREAM),
// chaque call fait timeout 10s x 500 matchs = 80 min → timeout workflow.
// Mieux vaut skip un match que bloquer tout le scan.
import { fetchJson } from '../../net/fetcher.js';

export const FEED = 'https://1xbet.cg';
export const COUNTRY = 93;
export const PARTNER = 192;
const CF_WORKERS = [
  'https://hidden-pine-7436.veolalex3.workers.dev',
  'https://billowing-sea-2d8e.alvecapital60.workers.dev',
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

// Round-robin state pour spread la charge sur les CF workers (au lieu de
// toujours frapper le 1er, qui sature en premier).
let cfCursor = 0;
function orderedWorkers() {
  const start = cfCursor++ % CF_WORKERS.length;
  return CF_WORKERS.map((_, i) => CF_WORKERS[(start + i) % CF_WORKERS.length]);
}

// CF workers round-robin, timeout 10s + Scrape.do fallback quand tous les
// workers CF sont down (garantit que 1xbet remonte toujours en catalog).
let workerFailCount = 0;
let workerSuccessCount = 0;
let scrapeDoFallbackCount = 0;
const MAX_SCRAPEDO_PER_RUN = 20; // budget guard : max 20 fetches Scrape.do / scan
const SCRAPE_DO_KEY = process.env.SCRAPE_DO_KEY || '';

async function viaScrapeDoFallback(url) {
  if (!SCRAPE_DO_KEY) return null;
  const qs = new URLSearchParams({ token: SCRAPE_DO_KEY, url }).toString();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(`https://api.scrape.do/?${qs}`, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const body = await res.text();
    try { return JSON.parse(body); } catch { return null; }
  } catch { return null; } finally { clearTimeout(t); }
}

export async function viaWorker(url) {
  for (const w of orderedWorkers()) {
    const j = await fetchJson(`${w}/?url=${encodeURIComponent(url)}`, { headers: HEADERS, timeoutMs: 10_000 });
    if (j) { workerSuccessCount++; return j; }
    workerFailCount++;
  }
  // Fallback Scrape.do (~1cr/req). Utilise seulement si tous CF workers down.
  // Cap MAX_SCRAPEDO_PER_RUN pour proteger budget.
  if (scrapeDoFallbackCount < MAX_SCRAPEDO_PER_RUN) {
    const sc = await viaScrapeDoFallback(url);
    if (sc) {
      scrapeDoFallbackCount++;
      if (scrapeDoFallbackCount === 1 || scrapeDoFallbackCount % 10 === 0) {
        console.log(`[xbet] Scrape.do fallback active (${scrapeDoFallbackCount}/${MAX_SCRAPEDO_PER_RUN})`);
      }
      return sc;
    }
  }
  if (workerFailCount % 50 === 0) console.log(`[xbet] All fetch failed — success=${workerSuccessCount} fail=${workerFailCount} scrapeDo=${scrapeDoFallbackCount}`);
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
