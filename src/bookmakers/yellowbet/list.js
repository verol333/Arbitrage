import { BASE_URL, evapi, isVirtual, toMatch } from './api.js';

const SPORT_ID = 31;

export async function listPrematch(horizonHours = 72) {
  const now = new Date();
  const to = new Date(now.getTime() + horizonHours * 3600 * 1000);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const url = `${BASE_URL}/event/GetEvents?sportIds=${SPORT_ID}&fromDate=${iso(now)}&toDate=${iso(to)}`;
  const data = await evapi(url);
  const events = Array.isArray(data?.data) ? data.data : [];
  return events
    .filter((ev) => ev && ev.sid === SPORT_ID && !ev.lv && !isVirtual(ev))
    .map(toMatch)
    .filter((m) => m.home && m.away);
}

export async function listLive() {
  const data = await evapi(`${BASE_URL}/event/GetEvents?sportIds=${SPORT_ID}&isLive=true`);
  const events = Array.isArray(data?.data) ? data.data : [];
  return events
    .filter((ev) => ev && ev.sid === SPORT_ID && ev.lv && !isVirtual(ev))
    .map(toMatch)
    .filter((m) => m.home && m.away);
}
