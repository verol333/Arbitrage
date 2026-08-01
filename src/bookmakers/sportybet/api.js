// SportyBet Nigeria — API directe (pas de Cloudflare).
// 2 endpoints :
//   /api/ng/factsCenter/pcUpcomingEvents      → liste prématch avec markets inclus
//   /api/ng/factsCenter/liveOrPrematchEvents  → matchs live (score + temps + markets)
//   /api/ng/factsCenter/event?eventId=...     → détails d'un match (refresh cotes fresh)
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

// sr:sport:1 = football. Market IDs demandés (les plus utiles pour arbitrage) :
// 1=1X2, 18=Over/Under, 10=DC, 29=BTTS, 11=DNB, 26=Odd/Even, 14=Handicap Asian,
// 60100=1MT 1X2 (à vérifier), 36=? (à découvrir).
const MARKET_IDS = '1,18,10,29,11,26,36,14,60100';
const SPORT_ID_FOOTBALL = 'sr:sport:1';

async function sbFetch(url, timeoutMs = 20_000) {
  try {
    const res = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) { console.log(`[sportybet] ${url.split('?')[0].split('/').pop()} status=${res.status}`); return null; }
    return res.json();
  } catch (e) {
    console.log(`[sportybet] ${url.split('?')[0].split('/').pop()} err=${e.message}`);
    return null;
  }
}

// pcUpcomingEvents attend option + sortOption + timeline entier. `todayGames`
// et `timeline=8.4` (décimal) provoquent HTTP 422 en Nigeria. Params minimaux
// validés : sportId + option=1 + timeline=24 + sortOption=SORT_BY_DEFAULT.
export async function sbFetchUpcoming({ pageNum = 1, pageSize = 100 } = {}) {
  const ts = Date.now();
  const url = `${BASE}/api/ng/factsCenter/pcUpcomingEvents?sportId=${encodeURIComponent(SPORT_ID_FOOTBALL)}&marketId=${encodeURIComponent(MARKET_IDS)}&pageSize=${pageSize}&pageNum=${pageNum}&option=1&timeline=24&sortOption=SORT_BY_DEFAULT&_t=${ts}`;
  return sbFetch(url);
}

export async function sbFetchLive() {
  const ts = Date.now();
  const url = `${BASE}/api/ng/factsCenter/liveOrPrematchEvents?sportId=${encodeURIComponent(SPORT_ID_FOOTBALL)}&_t=${ts}`;
  return sbFetch(url);
}

// Refresh cotes fraîches d'un match — utilisé au confirm live + prématch noCache.
export async function sbFetchEvent(matchId) {
  const ts = Date.now();
  const url = `${BASE}/api/ng/factsCenter/event?eventId=${encodeURIComponent(matchId)}&productId=3&_t=${ts}`;
  return sbFetch(url, 15_000);
}

// Filtre matchs virtuels/e-sport (rare sur SportyBet mais on couvre).
export const isVirtual = (s) => /\bcyber|esoccer|e-?soccer|virtual|simulated|\bsrl\b|\bfifa\b|\besport|\begt\b|\(sim\)|\bsim\b|\bvfl\b/i.test(s || '');
