// BetPawa Congo — 2 chemins :
//  1) Cloudflare Worker déployé par l'utilisateur (JSON propre, cotes incluses)
//     https://betpawa-scraper.veolalex3.workers.dev/?action=scrape
//     Convertit le protobuf en JSON avec matchs + cotes 1X2
//  2) Fallback : appel direct cg.betpawa.com/api/sportsbook/v4 (protobuf brut,
//     donne les matchs mais PAS les cotes floats binaires → non utilisable
//     seul, mais permet d'énumérer le catalogue)
//
// L'appel direct manque de cookies CF (__cf_bm) → réponse partielle sans
// odds. Le Worker CF gère l'auth CF correctement.
export const WORKER_URL = 'https://betpawa-scraper.veolalex3.workers.dev/?action=scrape';
export const BASE_DIRECT = 'https://cg.betpawa.com';

export const HDR_DIRECT = {
  'Accept': 'application/x-protobuf',
  'Accept-Language': 'fr-FR,fr;q=0.7',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'x-pawa-brand': 'betpawa-congobrazzaville',
  'x-pawa-language': 'fr',
  'x-device-fingerprint': '3d76d482c5a3e3a0d1374e637fd811bf',
  'Referer': 'https://cg.betpawa.com/events?categoryId=2&marketId=1X2',
  'Cookie': 'bp_country=CG',
};

export const CATEGORY_FOOTBALL = '2';
// Market types découverts via dump raw : 3743=1X2, 28000810=1X2 1UP, 28000850=1X2 2UP
// (les *UP sont des paris avec cashout anticipé — mêmes 3 outcomes que 1X2 standard).
// Pour capter Total, BTTS, DC il faudrait leurs market type IDs → à découvrir.
export const MARKET_TYPES = ['3743', '28000810', '28000850'];

export function buildEventsUrl({ eventType = 'UPCOMING', categories = [CATEGORY_FOOTBALL], marketTypes = MARKET_TYPES, skip = 0, take = 100 } = {}) {
  const q = {
    queries: [
      { query: { eventType, categories, zones: {}, hasOdds: true }, view: { marketTypes }, skip, take },
    ],
  };
  return `${BASE_DIRECT}/api/sportsbook/v4/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`;
}

// Appelle le Cloudflare Worker de l'utilisateur.
// Retourne { success, totalMatches, matchesWithOdds, matches: [{id, home, away, fullName, odds:[h,x,a]}] }.
export async function fetchViaWorker(timeoutMs = 30_000) {
  try {
    const res = await fetch(WORKER_URL, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) { console.log(`[betpawa/worker] status=${res.status}`); return null; }
    return res.json();
  } catch (e) {
    console.log(`[betpawa/worker] err=${e.message}`);
    return null;
  }
}

// Fallback appel direct protobuf → extraction ASCII (permet lister matchs
// sans odds ; utile si le Worker CF tombe).
export async function bpGetStringsDirect(url, timeoutMs = 20_000) {
  try {
    const res = await fetch(url, { headers: HDR_DIRECT, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) { console.log(`[betpawa/direct] status=${res.status}`); return []; }
    const buf = new Uint8Array(await res.arrayBuffer());
    const strings = [];
    let cur = '';
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      if (b >= 32 && b <= 126) cur += String.fromCharCode(b);
      else {
        if (cur.length > 2) strings.push(cur);
        cur = '';
      }
    }
    if (cur.length > 2) strings.push(cur);
    return strings.map(s => s.replace(/^["']|["']$/g, '').trim());
  } catch (e) {
    console.log(`[betpawa/direct] err=${e.message}`);
    return [];
  }
}

export const isVirtual = (s) => /\bcyber|esoccer|e-?soccer|virtual|simulated|\bsrl\b|\bfifa\b/i.test(s || '');

export function splitTeams(fullName) {
  const s = String(fullName || '').replace(/^["'#%]/, '').trim();
  const parts = s.split(/\s+-\s+/);
  if (parts.length < 2) return null;
  return { home: parts[0].trim(), away: parts.slice(1).join(' - ').trim() };
}
