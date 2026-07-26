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

// CF workers round-robin, timeout court (5s) pour fail-fast : mieux vaut
// perdre 1 match qu'attendre 10s à chaque échec sur 500 matchs.
export async function viaWorker(url) {
  for (const w of orderedWorkers()) {
    const j = await fetchJson(`${w}/?url=${encodeURIComponent(url)}`, { headers: HEADERS, timeoutMs: 5_000 });
    if (j) return j;
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
