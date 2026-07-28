import { API_BASE, ORIGIN, UA, PLATFORM, WIN_SID, WIN_SID_ALT } from './api.js';

async function winGetMany(sportId, offset, { live = false } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = live
    // Fenetre LIVE stricte : uniquement les matchs deja commences (pas +600s).
    // La fenetre "future" incluait des matchs pre-kickoff avec cotes pre-match.
    ? { sportId, isLive: true, startAtFrom: now - 4 * 3600, startAtTo: now, limit: 200, offset, l: 'en-001', p: PLATFORM }
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
  const hs = m.homeTeam?.score ?? m.competitors?.[0]?.score ?? m.team1?.score ?? null;
  const as = m.awayTeam?.score ?? m.competitors?.[1]?.score ?? m.team2?.score ?? null;
  const score = (hs != null && as != null) ? `${hs}-${as}` : (m.score || null);
  const minute = m.matchTime ?? m.minute ?? m.currentMinute ?? null;
  const period = m.matchStatus ?? m.status ?? m.period ?? null;
  return {
    id: m.id, home, away,
    league: m.tournament?.name || m.league?.name || m.category?.slug || '',
    start,
    live: { score, minute: Number.isFinite(minute) ? minute : null, period },
  };
}

const isReal = (m) => m.id && m.home && m.away
  && !/\(v\)/i.test(m.home) && !/\(v\)/i.test(m.away)
  && !/replay/i.test(m.home) && !/replay/i.test(m.away)
  && !/\bsrl\b|simulated|\besoccer\b|e-?soccer|\bcyber\b|\bvirtual\b|\besports?\b|\bfifa\b|\bpes\b|\be-?/i.test(`${m.home} ${m.away} ${m.league || ''}`);

// 1win expose plusieurs sportId pour un même sport (ex. basket VTB=19 et PBA=23).
// On concatène tous les IDs mappés puis on dédup par match.id.
function sportIdsFor(sport) {
  const alt = WIN_SID_ALT[sport] || null;
  if (alt && alt.length) return alt;
  const sid = WIN_SID[sport];
  return sid ? [sid] : [];
}

export async function listPrematch(sport = 'football') {
  const sids = sportIdsFor(sport);
  if (!sids.length) return [];
  const raw = [];
  for (const sid of sids) {
    for (let page = 0; page < 3; page++) {
      const items = await winGetMany(sid, page * 1000);
      raw.push(...items);
      if (items.length < 1000) break;
    }
  }
  const out = new Map();
  for (const m of raw.map(toMatch).filter(isReal)) {
    if (!out.has(m.id)) out.set(m.id, m);
  }
  return [...out.values()];
}

export async function listLive(sport = 'football') {
  const sids = sportIdsFor(sport);
  if (!sids.length) return [];
  const raw = [];
  for (const sid of sids) {
    const items = await winGetMany(sid, 0, { live: true });
    raw.push(...items);
  }
  const out = new Map();
  for (const m of raw.map(toMatch).filter(isReal)) {
    if (!out.has(m.id)) out.set(m.id, m);
  }
  return [...out.values()];
}
