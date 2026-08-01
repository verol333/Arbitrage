// BetPawa Congo — API sportsbook v4 (protobuf).
// Domaine découvert via CF Worker de l'utilisateur : cg.betpawa.com
// Format réponse : protobuf → on extrait les chaînes ASCII pour lire team
// names + market names + cotes (float décimal).
export const BASE = 'https://cg.betpawa.com';

export const HDR = {
  'Accept': 'application/x-protobuf',
  'Accept-Language': 'fr-FR,fr;q=0.7',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'x-pawa-brand': 'betpawa-congobrazzaville',
  'x-pawa-language': 'fr',
  'x-device-fingerprint': '3d76d482c5a3e3a0d1374e637fd811bf',
  'Referer': 'https://cg.betpawa.com/events?categoryId=2&marketId=1X2',
  'Cookie': 'bp_country=CG',
};

// Category "2" = Football (validé via URL Referer partagée par l'utilisateur).
// marketTypes 3743 = 1X2 fulltime. Autres IDs (Total, BTTS, DC…) à découvrir
// via probes ultérieurs ; on inclut 28000810 / 28000850 comme le Worker CF
// (probablement Total Goals + BTTS d'après l'ordre habituel BetPawa).
export const CATEGORY_FOOTBALL = '2';
export const MARKET_TYPES = ['3743', '28000810', '28000850'];

// Construit l'URL /events/lists/by-queries avec le JSON encodé.
export function buildEventsUrl({ eventType = 'UPCOMING', categories = [CATEGORY_FOOTBALL], marketTypes = MARKET_TYPES, skip = 0, take = 100 } = {}) {
  const q = {
    queries: [
      {
        query: { eventType, categories, zones: {}, hasOdds: true },
        view: { marketTypes },
        skip,
        take,
      },
    ],
  };
  return `${BASE}/api/sportsbook/v4/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`;
}

// Appel avec parsing protobuf → extrait toutes les chaînes ASCII imprimables.
// Chaque "string" séparée par bytes non-imprimables devient un élément.
export async function bpGetStrings(url, timeoutMs = 20_000) {
  try {
    const res = await fetch(url, {
      headers: HDR,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) { console.log(`[betpawa] ${url.slice(BASE.length, 100)}... status=${res.status}`); return []; }
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
    console.log(`[betpawa] err=${e.message}`);
    return [];
  }
}

export const isVirtual = (s) => /\bcyber|esoccer|e-?soccer|virtual|simulated|\bsrl\b|\bfifa\b/i.test(s || '');

export function splitTeams(fullName) {
  const s = String(fullName || '');
  const parts = s.split(/\s+-\s+/);
  if (parts.length < 2) return null;
  return { home: parts[0].trim(), away: parts.slice(1).join(' - ').trim() };
}
