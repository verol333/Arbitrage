// Audit SportyBet : dump TOUS les market IDs présents dans les 3 premiers matchs
// de liveOrPrematchEvents (qui contient déjà markets[] embarqués).

const BASE = 'https://www.sportybet.com';
const HDR = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  'Accept': '*/*', 'Accept-Language': 'en',
  'Referer': 'https://www.sportybet.com/ng/sport/football/today',
  'Origin': 'https://www.sportybet.com',
  'Cookie': 'locale=en; device-id=b0671631-24f3-4e60-a281-117254ea1551; sb_country=ng',
  'clientid': 'web', 'operid': '2', 'platform': 'web',
};

async function fetchJson(url) {
  const res = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) { console.log(`HTTP ${res.status}`); return null; }
  return res.json();
}

const live = await fetchJson(`${BASE}/api/ng/factsCenter/liveOrPrematchEvents?sportId=sr%3Asport%3A1&_t=${Date.now()}`);

// Chercher un match qui a des markets embarqués (chose rare sur liveOrPrematchEvents)
const eventsWithMarkets = [];
for (const t of live?.data || []) {
  for (const e of t?.events || []) {
    const nm = (e.markets || []).length;
    if (nm > 0) eventsWithMarkets.push({ ev: e, nMarkets: nm });
  }
}

console.log(`\n=== ${eventsWithMarkets.length} matchs avec markets sur liveOrPrematchEvents ===\n`);

// Fallback : essayer avec pcUpcomingEvents (avec marketId=all pour voir tout ce qu'il retourne)
// D'après doc, marketId=1,2,3,...,60100 : essayer un range large
if (eventsWithMarkets.length === 0) {
  console.log(`> Fallback : essayer avec pcUpcomingEvents + marketIds étendus\n`);
  // Essayons tous les IDs de 1 à 100 + variants 60000+ + spécifiques SportyBet
  const wideMarketIds = [
    // Basique
    1, 2, 3, 10, 11, 12, 14, 16, 18, 19, 20, 26, 29, 45, 47, 60,
    // Ranges intéressantes
    68, 74, 77, 81, 89, 90, 91, 92, 100, 128, 129, 165, 166,
    // 60xxx (1MT/2MT)
    60100, 60101, 60102, 60103, 60104, 60105,
    // 70xxx
    70000, 70001, 70002,
  ].join(',');
  const up = await fetchJson(`${BASE}/api/ng/factsCenter/pcUpcomingEvents?sportId=sr%3Asport%3A1&marketId=${wideMarketIds}&pageSize=5&pageNum=1&option=1&timeline=24&sortOption=SORT_BY_DEFAULT&_t=${Date.now()}`);
  for (const t of up?.data?.tournaments || []) {
    for (const e of t?.events || []) {
      const nm = (e.markets || []).length;
      if (nm > 0) eventsWithMarkets.push({ ev: e, nMarkets: nm });
    }
  }
  console.log(`> Fallback : ${eventsWithMarkets.length} matchs\n`);
}

// Dump les markets des 3 premiers matchs
for (const { ev, nMarkets } of eventsWithMarkets.slice(0, 3)) {
  console.log(`\n████ ${ev.homeTeamName} vs ${ev.awayTeamName} — id=${ev.eventId} — ${nMarkets} markets`);
  const markets = ev.markets || [];
  const uniqIds = new Set();
  for (const m of markets) {
    uniqIds.add(String(m.id));
    const spec = m.specifier ? ` [${m.specifier}]` : '';
    const outs = (m.outcomes || []).map((o) => `${o.desc}=${o.odds}`).join(' | ');
    console.log(`  id=${m.id}  ${m.name || m.desc || '?'}${spec}  →  ${outs}`);
  }
  console.log(`  → uniqIds: ${[...uniqIds].join(', ')}`);
}
console.log('\nDONE');
