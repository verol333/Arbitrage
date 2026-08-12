import { BASE_URL, evapi, isVirtual, toMatch } from './api.js';

// Sport IDs YellowBet (validés via probe v3 : dump 500 events sans filter,
// group par ev.sid + ev.sn) :
//   31=Soccer, 32=Basketball, 35=Tennis, 323=Volleyball, 334=Beach Volley,
//   319=Snooker, 320=Table Tennis, 310=Boxing, 312=Rugby, 321=Cricket,
//   326=Waterpolo, 3117=MMA, 3137=eSoccer (skip).
// Hockey : introuvable dans le catalogue YellowBet (pas d'événements identifiés).
// Note : le paramètre `sportIds=` semble ignoré côté API — on doit filtrer
// côté client via ev.sid après un fetch large.
// Volleyball YellowBet : sid=323 (confirme via probe 2026-08-11 - matchs Pan
// American Cup + Pro League partages avec 1xbet/SportyBet/1win/Congobet).
const SPORT_IDS = { football: 31, tennis: 35, basket: 32, volleyball: 323 };

// L'URL avec fromDate/toDate déclenche un 403 Cloudflare (pattern typique scraper).
// L'URL simple ?count=N&take=N (comme utilisée en live) passe. On filtre l'horizon
// client-side sur ev.gt.
export async function listPrematch(horizonHours = 72, sport = 'football') {
  const sportId = SPORT_IDS[sport];
  if (!sportId) return [];
  const nowMs = Date.now();
  const horizonMs = nowMs + horizonHours * 3600 * 1000;
  const collected = new Map();
  const PAGE = 500;
  // Pagination sans fromDate/toDate (bypass CF block). skip/take fonctionnent.
  for (let skip = 0; skip < 3000; skip += PAGE) {
    const url = `${BASE_URL}/event/GetEvents?skip=${skip}&take=${PAGE}&count=${PAGE}`;
    const data = await evapi(url);
    const events = Array.isArray(data?.data) ? data.data : [];
    if (!events.length) break;
    let added = 0;
    for (const ev of events) {
      if (!ev || collected.has(ev.id)) continue;
      if (ev.sid !== sportId || ev.lv || isVirtual(ev)) continue;
      // Filter horizon client-side (l'API retourne tout, on garde ± dans la fenêtre)
      const startMs = ev.gt ? new Date(ev.gt).getTime() : null;
      if (startMs && (startMs < nowMs - 2 * 60_000 || startMs > horizonMs)) continue;
      const m = toMatch(ev);
      if (m.home && m.away) { collected.set(ev.id, m); added++; }
    }
    if (added === 0 && events.length < PAGE) break;
    if (events.length < PAGE) break;
  }
  return [...collected.values()];
}

export async function listLive(sport = 'football') {
  const sportId = SPORT_IDS[sport];
  if (!sportId) return [];
  const data = await evapi(`${BASE_URL}/event/GetEvents?isLive=true&count=500&take=500`);
  const events = Array.isArray(data?.data) ? data.data : [];
  return events
    .filter((ev) => ev && ev.sid === sportId && ev.lv && !isVirtual(ev))
    .map(toMatch)
    .filter((m) => m.home && m.away);
}
