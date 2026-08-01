import { mget, isVirtual, isOutright, splitTeams } from './api.js';

const SPORT_ID = '1';
const NON_FOOT_RE = /tennis|baseball|basketball|volleyball|hockey|mma|boxing|cricket|\bnfl\b|\bnba\b|\bnhl\b|\bmlb\b|table tennis|snooker|darts|handball|rugby|badminton|golf|esports?|counter.?strike|dota|starcraft|league of legends/i;

function extractEvents(result) {
  if (!result || !result.data) return [];
  const data = result.data;
  if (Array.isArray(data)) return data;
  const out = [];
  for (const cat of (data.categories || [])) {
    for (const comp of (cat.competitions || [])) {
      out.push(...(comp.events || []));
    }
  }
  return out;
}

export async function listMatches({ live = false, horizonHours = 168, maxMatches = 600 } = {}) {
  const nowMs = Date.now();
  const horizonMs = nowMs + horizonHours * 3600_000;
  const ids = new Map();

  const endpoints = live
    ? [{ path: '/events/live', extra: { sportId: SPORT_ID, zoomSportId: '61' } }]
    : [
        { path: '/events/upcoming', extra: { sportId: SPORT_ID, timeOffset: '-60', date: new Date().toISOString().slice(0, 10) } },
        { path: '/events/highlights', extra: { sportId: SPORT_ID } },
      ];

  const results = await Promise.all(endpoints.map(({ path, extra }) => mget(path, extra)));
  const counts = {};

  for (let i = 0; i < results.length; i++) {
    const name = endpoints[i].path.split('/').pop();
    const events = extractEvents(results[i]);
    counts[name] = events.length;
    for (const ev of events) {
      if (!ev.id || ids.has(ev.id)) continue;
      ids.set(ev.id, ev);
    }
  }

  const out = [];
  let filtered = { outright: 0, virtual: 0, horizon: 0, noTeams: 0, nonFoot: 0 };

  for (const ev of ids.values()) {
    const teams = splitTeams(ev.eventNames);
    if (!teams) { filtered.noTeams++; continue; }
    if (teams.home.includes(' / ') || teams.away.includes(' / ')) { filtered.nonFoot++; continue; }
    const cat = [ev.categoryName, ev.competitionName].filter(Boolean).join(' ');
    if (NON_FOOT_RE.test(cat)) { filtered.nonFoot++; continue; }
    const label = `${teams.home} ${teams.away} ${cat}`;
    if (isOutright(ev.eventNames?.join?.(' ') || '')) { filtered.outright++; continue; }
    if (isVirtual(label)) { filtered.virtual++; continue; }
    if (!live) {
      const st = ev.startTime;
      if (!st || st <= nowMs + 2 * 60_000 || st > horizonMs) { filtered.horizon++; continue; }
    }
    out.push({
      id: String(ev.id),
      home: teams.home,
      away: teams.away,
      league: ev.competitionName || ev.categoryName || '',
      start: ev.startTime || null,
    });
    if (out.length >= maxMatches) break;
  }

  const src = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`[premierbet] ${src} unique=${ids.size} kept=${out.length} filtered=(outright:${filtered.outright} virtual:${filtered.virtual} horizon:${filtered.horizon} noTeams:${filtered.noTeams} nonFoot:${filtered.nonFoot})`);
  return out;
}
