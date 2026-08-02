// Probe rapide SportyBet pcUpcomingEvents : teste plusieurs variantes de params
// en parallèle et affiche pour chacune : status HTTP, taille payload, nb events.
// Objectif : trouver la combinaison qui marche sans attendre un scan complet.

const BASE = 'https://www.sportybet.com';
const HDR = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en',
  'Referer': 'https://www.sportybet.com/ng/sport/football/today',
  'Origin': 'https://www.sportybet.com',
  'Cookie': 'locale=en; device-id=b0671631-24f3-4e60-a281-117254ea1551; sb_country=ng',
  'clientid': 'web',
  'operid': '2',
  'platform': 'web',
};

const SPORT = encodeURIComponent('sr:sport:1');
const MARKETS = encodeURIComponent('1,18,10,29,11,26,36,14,60100');

// Focus : trouver la max pageSize acceptée + tester ordre params avec _t
const _t = Date.now();
const OPTS = `option=1&timeline=24&sortOption=SORT_BY_DEFAULT`;
const variants = [
  { name: 'PS20 no_t', url: `${BASE}/api/ng/factsCenter/pcUpcomingEvents?sportId=${SPORT}&marketId=${MARKETS}&pageSize=20&pageNum=1&${OPTS}` },
  { name: 'PS20 with_t', url: `${BASE}/api/ng/factsCenter/pcUpcomingEvents?sportId=${SPORT}&marketId=${MARKETS}&pageSize=20&pageNum=1&${OPTS}&_t=${_t}` },
  { name: 'PS50 with_t', url: `${BASE}/api/ng/factsCenter/pcUpcomingEvents?sportId=${SPORT}&marketId=${MARKETS}&pageSize=50&pageNum=1&${OPTS}&_t=${_t}` },
  { name: 'PS100 with_t (bundle URL actuel)', url: `${BASE}/api/ng/factsCenter/pcUpcomingEvents?sportId=${SPORT}&marketId=${MARKETS}&pageSize=100&pageNum=1&${OPTS}&_t=${_t}` },
  { name: 'PS100 no_t', url: `${BASE}/api/ng/factsCenter/pcUpcomingEvents?sportId=${SPORT}&marketId=${MARKETS}&pageSize=100&pageNum=1&${OPTS}` },
  { name: 'PS200 no_t', url: `${BASE}/api/ng/factsCenter/pcUpcomingEvents?sportId=${SPORT}&marketId=${MARKETS}&pageSize=200&pageNum=1&${OPTS}` },
];

async function probe(v) {
  try {
    const t0 = Date.now();
    const res = await fetch(v.url, { headers: HDR, signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    const ms = Date.now() - t0;
    let jn = null; let events = null;
    try { jn = JSON.parse(text); } catch {}
    if (jn?.data?.tournaments) {
      let n = 0;
      for (const t of jn.data.tournaments) n += (t?.events?.length || 0);
      events = `tournaments=${jn.data.tournaments.length} totalEvents=${n}`;
    } else if (jn?.data?.events) events = `events=${jn.data.events.length}`;
    else if (Array.isArray(jn?.data)) events = `dataArray=${jn.data.length}`;
    else events = `keys=${jn ? Object.keys(jn).join(',') : 'notJson'}`;
    console.log(`[${v.name}] status=${res.status} ms=${ms} size=${text.length}b ${events}`);
    if (res.status === 422) console.log(`   body_head: ${text.slice(0, 200)}`);
  } catch (e) {
    console.log(`[${v.name}] ERR ${e.message}`);
  }
}

await Promise.all(variants.map(probe));
console.log('DONE');
