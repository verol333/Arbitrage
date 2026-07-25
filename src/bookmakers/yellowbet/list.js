import { BASE_URL, evapi, isVirtual, toMatch } from './api.js';

// Sport IDs YellowBet (validés via probe v3 : dump 500 events sans filter,
// group par ev.sid + ev.sn) :
//   31=Soccer, 32=Basketball, 35=Tennis, 323=Volleyball, 334=Beach Volley,
//   319=Snooker, 320=Table Tennis, 310=Boxing, 312=Rugby, 321=Cricket,
//   326=Waterpolo, 3117=MMA, 3137=eSoccer (skip).
// Hockey : introuvable dans le catalogue YellowBet (pas d'événements identifiés).
// Note : le paramètre `sportIds=` semble ignoré côté API — on doit filtrer
// côté client via ev.sid après un fetch large.
const SPORT_IDS = { football: 31, basketball: 32, tennis: 35, volleyball: 323 };

// L'API evapi renvoie ~72 matchs par défaut. On force un count élevé et on tente
// une pagination si l'API supporte skip/take. Champs de tri : gt (game time).
export async function listPrematch(horizonHours = 72, sport = 'football') {
  const sportId = SPORT_IDS[sport];
  if (!sportId) return [];
  const now = new Date();
  const to = new Date(now.getTime() + horizonHours * 3600 * 1000);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const collected = new Map();
  const PAGE = 500;
  for (let skip = 0; skip < 3000; skip += PAGE) {
    const url = `${BASE_URL}/event/GetEvents?fromDate=${iso(now)}&toDate=${iso(to)}&skip=${skip}&take=${PAGE}&count=${PAGE}&pageSize=${PAGE}`;
    const data = await evapi(url);
    const events = Array.isArray(data?.data) ? data.data : [];
    if (!events.length) break;
    let added = 0;
    for (const ev of events) {
      if (!ev || collected.has(ev.id)) continue;
      // Filter client-side : le param sportIds= est ignoré par l'API YellowBet.
      if (ev.sid !== sportId || ev.lv || isVirtual(ev)) continue;
      const m = toMatch(ev);
      if (m.home && m.away) { collected.set(ev.id, m); added++; }
    }
    if (added === 0) break;
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
