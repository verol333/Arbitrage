// BetPawa Congo — appel direct API sportsbook v4 (protobuf) + décodage floats.
// Le Worker CF de l'utilisateur retourne seulement matchs sans odds, donc on
// bypass et on décode le protobuf nous-mêmes.
//
// Format observé :
// - strings ASCII (32-126) : IDs, noms, market labels
// - floats cotes : encoded IEEE-754 little-endian 4 bytes (souvent après un
//   varint tag). On les extrait en scannant les 4-byte windows après chaque
//   marker de marché.
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

export const CATEGORY_FOOTBALL = '2';
export const MARKET_TYPES = ['3743', '28000810', '28000850'];

export function buildEventsUrl({ eventType = 'UPCOMING', categories = [CATEGORY_FOOTBALL], marketTypes = MARKET_TYPES, skip = 0, take = 100 } = {}) {
  const q = {
    queries: [
      { query: { eventType, categories, zones: {}, hasOdds: true }, view: { marketTypes }, skip, take },
    ],
  };
  return `${BASE}/api/sportsbook/v4/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`;
}

// Retourne { strings: [...], buf: Uint8Array } pour permettre extraction
// des floats binaires en plus des strings ASCII.
export async function bpFetchProtobuf(url, timeoutMs = 20_000) {
  try {
    const res = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) { console.log(`[betpawa] status=${res.status}`); return null; }
    const buf = new Uint8Array(await res.arrayBuffer());
    // Extraction strings + tracking des positions (byte offset dans buf).
    const strings = [];
    const positions = []; // parallel array : position (byte offset) où string commence
    let cur = '';
    let curStart = 0;
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      if (b >= 32 && b <= 126) {
        if (cur.length === 0) curStart = i;
        cur += String.fromCharCode(b);
      } else {
        if (cur.length > 2) {
          strings.push(cur);
          positions.push(curStart);
        }
        cur = '';
      }
    }
    if (cur.length > 2) { strings.push(cur); positions.push(curStart); }
    return { buf, strings: strings.map(s => s.replace(/^["']|["']$/g, '').trim()), positions };
  } catch (e) {
    console.log(`[betpawa] err=${e.message}`);
    return null;
  }
}

// Cherche les 3 floats IEEE-754 (little-endian, 4 bytes) après un byte offset
// donné, dans une fenêtre de N bytes. Retourne les floats valides dans la
// plage des cotes de paris [1.01, 500].
export function extractFloats(buf, fromByte, windowBytes = 500, want = 3) {
  const found = [];
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const end = Math.min(fromByte + windowBytes, buf.length - 4);
  for (let i = fromByte; i <= end && found.length < want; i++) {
    const f = view.getFloat32(i, true);  // little-endian
    if (Number.isFinite(f) && f >= 1.01 && f <= 500) found.push({ pos: i, value: Math.round(f * 100) / 100 });
  }
  return found;
}

export const isVirtual = (s) => /\bcyber|esoccer|e-?soccer|virtual|simulated|\bsrl\b|\bfifa\b/i.test(s || '');

export function splitTeams(fullName) {
  const s = String(fullName || '').replace(/^["'#%]/, '').replace(/["']$/, '').trim();
  const parts = s.split(/\s+-\s+/);
  if (parts.length < 2) return null;
  return { home: parts[0].trim(), away: parts.slice(1).join(' - ').trim() };
}
