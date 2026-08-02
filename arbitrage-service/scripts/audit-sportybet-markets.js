// Audit SportyBet : dump TOUS les market IDs + noms + outcomes pour 3 matchs
// via /event?eventId=... → identifier le vrai ID de "1MT 1X2" (currentement 60100
// est mappé au bug qui a produit 875 fake arbs).

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
  if (!res.ok) { console.log(`HTTP ${res.status} ${url.slice(-60)}`); return null; }
  return res.json();
}

// 1. Récupère 3 matchs upcoming
const upcoming = await fetchJson(`${BASE}/api/ng/factsCenter/pcUpcomingEvents?sportId=sr%3Asport%3A1&pageSize=100&pageNum=1&option=1&timeline=24&sortOption=SORT_BY_DEFAULT&_t=${Date.now()}`);
const events = [];
for (const t of upcoming?.data?.tournaments || []) {
  for (const e of t?.events || []) events.push(e);
  if (events.length >= 3) break;
}
console.log(`\n=== ${events.length} matchs sample ===\n`);

// 2. Pour chaque match, fetch /event?eventId=X et dump TOUS les markets
for (const ev of events.slice(0, 3)) {
  const id = ev.eventId;
  console.log(`\n████ ${ev.homeTeamName} vs ${ev.awayTeamName} — id=${id}`);
  console.log(`      URL: ${BASE}/ng/sport/football/${(ev.sport?.category?.tournament?.categoryName || 'x').replace(/\s+/g, '_')}/${(ev.sport?.category?.tournament?.name || 'x').replace(/\s+/g, '_')}/${(ev.homeTeamName || '').replace(/\s+/g, '_')}_vs_${(ev.awayTeamName || '').replace(/\s+/g, '_')}/sr:match:${String(id).replace(/^sr:match:/, '')}`);

  const detail = await fetchJson(`${BASE}/api/ng/factsCenter/event?eventId=${encodeURIComponent(id)}&productId=3&_t=${Date.now()}`);
  const markets = detail?.data?.markets || [];
  console.log(`      ${markets.length} markets`);

  for (const m of markets) {
    const spec = m.specifier ? ` [${m.specifier}]` : '';
    const outs = (m.outcomes || []).map((o) => `${o.desc}=${o.odds}`).join(' | ');
    console.log(`  id=${m.id}  ${m.name}${spec}  →  ${outs}`);
  }
}
console.log('\nDONE');
