// BetPawa Congo — 2 endpoints :
//  1) POST /api/sportsbook/v4/events/lists/by-queries (protobuf) → LISTE des IDs matchs
//  2) GET  /api/sportsbook/v4/events/{id} (JSON) → détails d'un match avec markets + cotes
// Code fourni par l'utilisateur confirmé sur son Cloudflare Worker.
export const BASE = 'https://cg.betpawa.com';

export const HDR_LIST = {
  'Accept': 'application/x-protobuf',
  'Accept-Language': 'fr-FR,fr;q=0.7',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36',
  'x-pawa-brand': 'betpawa-congobrazzaville',
  'x-pawa-language': 'fr',
  'Referer': 'https://cg.betpawa.com/events?categoryId=2&marketId=1X2',
  'Cookie': 'bp_country=CG',
};

export const HDR_EVENT = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.7',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36',
  'x-pawa-brand': 'betpawa-congobrazzaville',
  'x-pawa-language': 'fr',
  'Referer': 'https://cg.betpawa.com/events?categoryId=2&marketId=1X2',
  'Cookie': 'bp_country=CG',
};

export const CATEGORY_FOOTBALL = '2';
export const MARKET_TYPES = ['3743', '28000810', '28000850'];

export function buildEventsListUrl({ eventType = 'UPCOMING', categories = [CATEGORY_FOOTBALL], marketTypes = MARKET_TYPES, skip = 0, take = 100 } = {}) {
  const q = {
    queries: [
      { query: { eventType, categories, zones: {}, hasOdds: true }, view: { marketTypes }, skip, take },
    ],
  };
  return `${BASE}/api/sportsbook/v4/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`;
}

// Extraction ASCII strings du protobuf pour trouver les IDs matchs.
export async function bpFetchList(url, timeoutMs = 20_000) {
  try {
    const res = await fetch(url, { headers: HDR_LIST, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) { console.log(`[betpawa/list] status=${res.status}`); return []; }
    const buf = new Uint8Array(await res.arrayBuffer());
    const strings = [];
    let cur = '';
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      if (b >= 32 && b <= 126) cur += String.fromCharCode(b);
      else { if (cur.length > 2) strings.push(cur); cur = ''; }
    }
    if (cur.length > 2) strings.push(cur);
    return strings.map(s => s.replace(/^["']|["']$/g, '').trim());
  } catch (e) {
    console.log(`[betpawa/list] err=${e.message}`);
    return [];
  }
}

// Récupère détails d'un match (JSON avec markets + cotes).
export async function bpFetchEvent(matchId, timeoutMs = 15_000) {
  try {
    const res = await fetch(`${BASE}/api/sportsbook/v4/events/${matchId}`, {
      headers: HDR_EVENT,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) { console.log(`[betpawa/event ${matchId}] status=${res.status}`); return null; }
    return res.json();
  } catch (e) {
    console.log(`[betpawa/event ${matchId}] err=${e.message}`);
    return null;
  }
}

// Filtre matchs virtuels/e-sport : cyber, esoccer, e-soccer, virtual, simulated,
// srl (Simulated Reality League), fifa, gt leagues, (sim), suffixe " Esports".
// Complète le filtre après avoir observé des matchs virtuels remontés depuis l'API.
export const isVirtual = (s) => /(\bcyber|esoccer|e-?soccer|virtual|simulated|\bsrl\b|\bfifa\b|\besport|\begt\b|\bgt leagues|\(sim\)|\bsim\b|\bvfl\b)/i.test(s || '');

export function splitTeams(fullName) {
  const s = String(fullName || '').replace(/^["'#%]/, '').replace(/["']$/, '').trim();
  const parts = s.split(/\s+-\s+/);
  if (parts.length < 2) return null;
  return { home: parts[0].trim(), away: parts.slice(1).join(' - ').trim() };
}
