// Accès 1xbet via multi-proxy : CF workers (random) → jina.ai gratuit → direct.
// Objectif : 100% dispo même quand un canal tombe.
import { fetchJson } from '../../net/fetcher.js';
import { stealthGetJson } from '../../net/stealth.js';

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

// Multi-fallback : CF workers (rotation round-robin) → stealth fetch direct.
// jina.ai retiré (nécessite clé API, on n'en a pas).
// Le premier qui répond avec du JSON valide gagne.
export async function viaWorker(url) {
  // Tier 1: CF workers en round-robin (spread la charge, évite épuisement d'un)
  for (const w of orderedWorkers()) {
    const j = await fetchJson(`${w}/?url=${encodeURIComponent(url)}`, { headers: HEADERS, timeoutMs: 9_000 });
    if (j) return j;
  }
  // Tier 2: fetch direct via stealth (rotation fingerprint, IP GH parfois OK)
  const j = await stealthGetJson(url, { headers: HEADERS, timeoutMs: 10_000 });
  return j || null;
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
