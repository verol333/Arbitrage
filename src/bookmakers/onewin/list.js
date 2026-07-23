// Listing 1win football via REST /matches/get-many (port fidèle de matchCore.ts).
import { API_BASE, ORIGIN, UA, PLATFORM, WIN_SID } from './api.js';

async function winGetMany(offset, { live = false } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = live
    ? { sportId: WIN_SID.football, isLive: true, startAtFrom: now - 4 * 3600, startAtTo: now + 600, limit: 200, offset, l: 'en-001', p: PLATFORM }
    : { sportId: WIN_SID.football, startAtFrom: now - 3600, startAtTo: now + 3 * 86400, limit: 1000, offset, l: 'en-001', p: PLATFORM };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(`${API_BASE}/matches/get-many`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Referer: `${ORIGIN}/`, 'User-Agent': UA },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = res.ok ? await res.json() : null;
    return data?.result?.items || [];
  } finally { clearTimeout(t); }
}

function toMatch(m) {
  const home = m.homeTeam?.name || m.competitors?.[0]?.name || m.team1?.name;
  const away = m.awayTeam?.name || m.competitors?.[1]?.name || m.team2?.name;
  const startRaw = m.startAt || m.startsAt || m.startTime;
  let start = null;
  if (startRaw) start = typeof startRaw === 'number' ? (startRaw < 1e12 ? startRaw * 1000 : startRaw) : new Date(startRaw).getTime();
  return {
    id: m.id, home, away,
    league: m.tournament?.name || m.league?.name || m.category?.slug || '',
    start,
  };
}

const isReal = (m) => m.id && m.home && m.away
  && !/\(v\)/i.test(m.home) && !/\(v\)/i.test(m.away)
  && !/\([^)]+\)/.test(m.home) && !/\([^)]+\)/.test(m.away)
  && !/replay/i.test(m.home) && !/replay/i.test(m.away)
  && !/cyber|virtual/i.test(m.league || '');

export async function listPrematch() {
  const raw = [];
  for (let page = 0; page < 3; page++) {
    const items = await winGetMany(page * 1000);
    raw.push(...items);
    if (items.length < 1000) break;
  }
  return raw.map(toMatch).filter(isReal);
}

export async function listLive() {
  const items = await winGetMany(0, { live: true });
  return items.map(toMatch).filter(isReal);
}
