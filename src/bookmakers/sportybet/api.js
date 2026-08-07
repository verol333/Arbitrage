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

// Sport IDs SportyBet (SportRadar) : sr:sport:1 = football, sr:sport:2 = basket, sr:sport:5 = tennis.
// Market IDs demandés (utiles pour arbitrage) :
// FOOT : 1=1X2, 18=Over/Under, 10=DC, 29=BTTS, 11=DNB, 26=Odd/Even, 14=Handicap Asian, 60100=1MT 1X2.
// TENNIS : 186=Match Winner (pas de X), 68=Total Sets, 89=Set 1 Winner, 187-190=Games/Hcp.
// BASKET (incl OT) : 219=Winner, 223=Asian Hcp, 225=Total, 227=Home TT, 228=Away TT, 229=Odd/Even.
//                    60=1H 1X2, 66=1H Asian Hcp, 68=1H Total, 83=2H 1X2.
//                    235=Q1-Q4 1X2 (spec.quarternr), 303=Q1-Q4 Hcp, 236=Q1-Q4 Total, 304=Q1-Q4 O/E.
const MARKET_IDS_FOOTBALL = '1,18,10,29,11,26,36,14,60100';
const MARKET_IDS_TENNIS = '186,68,89,166,187,189,190,340'; // Winner + Sets + Games + Handicap
const MARKET_IDS_BASKET = '219,223,225,227,228,229,60,66,68,83,235,236,303,304';
export const SB_SPORT_IDS = { football: 'sr:sport:1', tennis: 'sr:sport:5', basket: 'sr:sport:2' };
export const SB_MARKET_IDS = { football: MARKET_IDS_FOOTBALL, tennis: MARKET_IDS_TENNIS, basket: MARKET_IDS_BASKET };

// Rotation d'user-agents pour eviter les 403 Cloudflare rate-limit.
// Diag 5books tennis a montre : Chrome 151 marche, autres UAs parfois bloques.
const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
];
let uaCursor = 0;

async function sbFetch(url, timeoutMs = 20_000) {
  // 3 tentatives avec UAs differents pour bypass rate-limit transitoire.
  for (let attempt = 0; attempt < 3; attempt++) {
    const ua = UAS[(uaCursor + attempt) % UAS.length];
    try {
      const res = await fetch(url, {
        headers: { ...HDR, 'User-Agent': ua },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        uaCursor = (uaCursor + attempt) % UAS.length;
        return res.json();
      }
      if (res.status === 403 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue; // retry avec autre UA
      }
      console.log(`[sportybet] ${url.split('?')[0].split('/').pop()} status=${res.status} (attempt ${attempt + 1})`);
      return null;
    } catch (e) {
      if (attempt >= 2) {
        console.log(`[sportybet] ${url.split('?')[0].split('/').pop()} err=${e.message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return null;
}

// pcUpcomingEvents attend option + sortOption + timeline entier. `todayGames`
// et `timeline=8.4` (décimal) provoquent HTTP 422 en Nigeria. Params minimaux
// validés : sportId + option=1 + timeline=24 + sortOption=SORT_BY_DEFAULT.
export async function sbFetchUpcoming({ pageNum = 1, pageSize = 100, sport = 'football' } = {}) {
  const ts = Date.now();
  const sid = SB_SPORT_IDS[sport];
  const mids = SB_MARKET_IDS[sport];
  if (!sid) return null;
  const url = `${BASE}/api/ng/factsCenter/pcUpcomingEvents?sportId=${encodeURIComponent(sid)}&marketId=${encodeURIComponent(mids)}&pageSize=${pageSize}&pageNum=${pageNum}&option=1&timeline=24&sortOption=SORT_BY_DEFAULT&_t=${ts}`;
  return sbFetch(url);
}

export async function sbFetchLive(sport = 'football') {
  const ts = Date.now();
  const sid = SB_SPORT_IDS[sport];
  if (!sid) return null;
  const url = `${BASE}/api/ng/factsCenter/liveOrPrematchEvents?sportId=${encodeURIComponent(sid)}&_t=${ts}`;
  return sbFetch(url);
}

// Refresh cotes fraîches d'un match — utilisé au confirm live + prématch noCache.
// productId=1 = LIVE, productId=3 = PREMATCH. Confondre les 2 renvoie 0 markets.
// Découvert 2026-08-02 via probe-live-dump : SB live avec productId=3 = 0 markets
// → confirm fallback silencieusement sur markets stale du listMatches (fake arbs).
export async function sbFetchEvent(matchId, { live = false } = {}) {
  const ts = Date.now();
  const productId = live ? 1 : 3;
  const url = `${BASE}/api/ng/factsCenter/event?eventId=${encodeURIComponent(matchId)}&productId=${productId}&_t=${ts}`;
  return sbFetch(url, 15_000);
}

// Filtre matchs virtuels/e-sport (rare sur SportyBet mais on couvre).
export const isVirtual = (s) => /\bcyber|esoccer|e-?soccer|virtual|simulated|\bsrl\b|\bfifa\b|\besport|\begt\b|\(sim\)|\bsim\b|\bvfl\b/i.test(s || '');
