// Listing 1win multi-sport via REST /matches/get-many.
import { API_BASE, ORIGIN, UA, PLATFORM, WIN_SID } from './api.js';

async function winGetMany(offset, { live = false, sport = 'football' } = {}) {
  const sportId = WIN_SID[sport] || WIN_SID.football;
  const now = Math.floor(Date.now() / 1000);
  const body = live
    ? { sportId, isLive: true, startAtFrom: now - 4 * 3600, startAtTo: now + 600, limit: 200, offset, l: 'en-001', p: PLATFORM }
    : { sportId, startAtFrom: now - 3600, startAtTo: now + 3 * 86400, limit: 1000, offset, l: 'en-001', p: PLATFORM };
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
  && !/replay/i.test(m.home) && !/replay/i.test(m.away)
  && !/\bsrl\b|simulated|\besoccer\b|e-?soccer|\bcyber\b|\bvirtual\b|\besports?\b|\bfifa\b|\bpes\b|\be-?fighting\b|\be-?basketball\b|\be-?hockey\b|\be-?tennis\b/i.test(`${m.home} ${m.away} ${m.league || ''}`);

export async function listPrematch({ sport = 'football' } = {}) {
  const raw = [];
  for (let page = 0; page < 3; page++) {
    const items = await winGetMany(page * 1000, { sport });
    raw.push(...items);
    if (items.length < 1000) break;
  }
  return raw.map(toMatch).filter(isReal);
}

export async function listLive({ sport = 'football' } = {}) {
  const items = await winGetMany(0, { live: true, sport });
  return items.map(toMatch).filter(isReal);
}
