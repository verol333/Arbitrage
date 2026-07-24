import { xget, parseTs, splitTeams, isVirtual } from './api.js';

const SPORT_LABEL = 'Football';

async function listSportEvents(live) {
  const [wc, hl] = await Promise.all([
    xget('getWidgetCentrali', {}),
    xget('getHomeLandingData', { timezone: '1' }),
  ]);
  const evs = [];
  if (wc) for (const bw of (wc.bws || [])) for (const av of (bw.avs || [])) evs.push(av);
  if (hl) for (const tm of (hl.tms || [])) evs.push(tm);
  if (hl && live) for (const lv of (hl.lvs || [])) evs.push(lv);

  const seen = new Set(); const out = [];
  for (const e of evs) {
    if (e.ds !== SPORT_LABEL) continue;
    const key = `${e.p}_${e.a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const teams = splitTeams(e.da);
    if (!teams) continue;
    if (isVirtual(`${teams.home} ${teams.away} ${e.dt || ''}`)) continue;
    out.push({ p: e.p, a: e.a, id: key, home: teams.home, away: teams.away, league: e.dt || e.dc || '', start: parseTs(e.ts) });
  }
  return out;
}

export async function listMatches({ live = false, maxMatches, horizonHours = 72 } = {}) {
  const limit = maxMatches ?? (live ? 80 : 200);
  const nowMs = Date.now();
  const horizonMs = nowMs + horizonHours * 3600 * 1000;
  let events = await listSportEvents(live);
  if (!live) events = events.filter((e) => e.start && e.start > nowMs + 2 * 60 * 1000 && e.start <= horizonMs);
  events = events.slice(0, limit);
  if (!events.length) return [];

  const BATCH = 12;
  const out = [];
  for (let i = 0; i < events.length; i += BATCH) {
    const chunk = events.slice(i, i + BATCH);
    const results = await Promise.all(chunk.map((e) =>
      xget('getEvento', { pal: String(e.p), avv: String(e.a), idAggregata: '-1', isLive: 'false' }, 15_000),
    ));
    for (let k = 0; k < chunk.length; k++) {
      const e = chunk[k];
      const j = results[k];
      const markets = j && Array.isArray(j.scs) ? j.scs : [];
      out.push({ id: e.id, home: e.home, away: e.away, league: e.league, start: e.start, __raw: { markets } });
    }
  }
  return out;
}
