import { BASE_URL, evapi, isVirtual, toMatch } from './api.js';

const SPORT_IDS = { football: 31, tennis: 32 };

export async function listPrematch(horizonHours = 72, { sport = 'football' } = {}) {
  const sid = SPORT_IDS[sport] || SPORT_IDS.football;
  const now = new Date();
  const to = new Date(now.getTime() + horizonHours * 3600 * 1000);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const url = `${BASE_URL}/event/GetEvents?sportIds=${sid}&fromDate=${iso(now)}&toDate=${iso(to)}`;
  const data = await evapi(url);
  const events = Array.isArray(data?.data) ? data.data : [];
  return events
    .filter((ev) => ev && ev.sid === sid && !ev.lv && !isVirtual(ev))
    .map(toMatch)
    .filter((m) => m.home && m.away);
}

export async function listLive({ sport = 'football' } = {}) {
  const sid = SPORT_IDS[sport] || SPORT_IDS.football;
  const data = await evapi(`${BASE_URL}/event/GetEvents?sportIds=${sid}&isLive=true`);
  const events = Array.isArray(data?.data) ? data.data : [];
  return events
    .filter((ev) => ev && ev.sid === sid && ev.lv && !isVirtual(ev))
    .map(toMatch)
    .filter((m) => m.home && m.away);
}
