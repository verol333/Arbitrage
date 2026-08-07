#!/usr/bin/env node
// PROBE BASKET IDs v4 — BetPawa uniquement (autres books déjà connus)
// Enum categoryId via endpoint prod /events/lists/by-queries + detect keywords.

const BASE = 'https://cg.betpawa.com';
const HDR = {
  Accept: 'application/x-protobuf',
  'Accept-Language': 'fr-FR,fr;q=0.7',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36',
  'x-pawa-brand': 'betpawa-congobrazzaville',
  'x-pawa-language': 'fr',
  Referer: 'https://cg.betpawa.com/events',
  Cookie: 'bp_country=CG',
};

function buildUrl(catId) {
  const q = {
    queries: [
      { query: { eventType: 'UPCOMING', categories: [String(catId)], zones: {}, hasOdds: true }, view: { marketTypes: [] }, skip: 0, take: 5 },
    ],
  };
  return `${BASE}/api/sportsbook/v4/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`;
}

async function probe(catId) {
  try {
    const r = await fetch(buildUrl(catId), { headers: HDR, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return { catId, status: r.status };
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length < 30) return { catId, status: r.status, empty: true };
    let cur = ''; const strings = [];
    for (const b of buf) {
      if (b >= 32 && b <= 126) cur += String.fromCharCode(b);
      else { if (cur.length > 3) strings.push(cur); cur = ''; }
    }
    if (cur.length > 3) strings.push(cur);
    const text = strings.join(' | ');
    const basketHit = /NBA|WNBA|Basket|BBL|Euroleague|Warriors|Lakers|Bulls|Heat|Celtics|Nets|Knicks|Sixers|Raptors/i.test(text);
    const teams = strings.filter(s => / - /.test(s) || /vs\.?/i.test(s)).slice(0, 3);
    return { catId, status: r.status, size: buf.length, basketHit, teams };
  } catch (e) { return { catId, err: e.message }; }
}

console.log('▶ PROBE BETPAWA basket categoryId v4\n');

// Range concentré : 1-100 (petits IDs custom) + 400-500 (autour du tennis 452)
// + 700-1000 (au cas où). Séquentiel pour éviter rate-limit.
const ranges = [
  ...Array.from({ length: 100 }, (_, i) => i + 1),
  ...Array.from({ length: 100 }, (_, i) => i + 400),
  ...Array.from({ length: 300 }, (_, i) => i + 700),
];

for (const id of ranges) {
  const r = await probe(id);
  if (r.status === 200 && !r.empty) {
    const flag = r.basketHit ? ' ✅ BASKET' : '';
    const sample = r.teams.length ? r.teams.slice(0, 1).join('') : '(no team-like string)';
    console.log(`  cat=${id} size=${r.size}B${flag} | ${sample}`);
  }
}

console.log('\n═══ FIN ═══');
