import { BASE_URL, evapi, isVirtual, toMatch } from './api.js';

const SPORT_ID = 31;

// L'API evapi renvoie ~72 matchs par défaut. On force un count élevé et on tente
// une pagination si l'API supporte skip/take. Champs de tri : gt (game time).
export async function listPrematch(horizonHours = 72) {
  const now = new Date();
  const to = new Date(now.getTime() + horizonHours * 3600 * 1000);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const collected = new Map();
  const PAGE = 500;
  for (let skip = 0; skip < 3000; skip += PAGE) {
    const url = `${BASE_URL}/event/GetEvents?sportIds=${SPORT_ID}&fromDate=${iso(now)}&toDate=${iso(to)}&skip=${skip}&take=${PAGE}&count=${PAGE}&pageSize=${PAGE}`;
    const data = await evapi(url);
    const events = Array.isArray(data?.data) ? data.data : [];
    if (!events.length) break;
    let added = 0;
    for (const ev of events) {
      if (!ev || collected.has(ev.id)) continue;
      if (ev.sid !== SPORT_ID || ev.lv || isVirtual(ev)) continue;
      const m = toMatch(ev);
      if (m.home && m.away) { collected.set(ev.id, m); added++; }
    }
    if (added === 0) break; // aucune nouveauté = fin
    if (events.length < PAGE) break; // page incomplète = fin
  }
  return [...collected.values()];
}

export async function listLive() {
  const data = await evapi(`${BASE_URL}/event/GetEvents?sportIds=${SPORT_ID}&isLive=true&count=500&take=500`);
  const events = Array.isArray(data?.data) ? data.data : [];
  return events
    .filter((ev) => ev && ev.sid === SPORT_ID && ev.lv && !isVirtual(ev))
    .map(toMatch)
    .filter((m) => m.home && m.away);
}
