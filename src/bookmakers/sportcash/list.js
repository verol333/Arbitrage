import { xget, parseTs, splitTeams, isVirtual } from './api.js';

const SPORT_LABEL = 'Football';

async function listSportEvents(live) {
  const [wc, hl] = await Promise.all([
    xget('getWidgetCentrali', {}),
    xget('getHomeLandingData', { timezone: '1' }),
  ]);
  const evs = [];
  // getWidgetCentrali.bws : widgets banners → chacun a .avs (top events).
  if (wc?.bws) for (const bw of wc.bws) for (const av of (bw.avs || [])) evs.push(av);
  // getWidgetCentrali.tms : top matches promus.
  if (wc?.tms) for (const tm of wc.tms) evs.push(tm);
  // getWidgetCentrali.lms : catalogue par sport ID (1=Foot, 2=Bk, etc.) → .avs
  if (wc?.lms) for (const sportKey of Object.keys(wc.lms)) {
    const bucket = wc.lms[sportKey];
    if (bucket?.avs) for (const av of bucket.avs) evs.push(av);
  }
  // getHomeLandingData.tms / lvs : top et live.
  if (hl?.tms) for (const tm of hl.tms) evs.push(tm);
  if (hl?.lvs) for (const lv of hl.lvs) {
    if (lv?.avs) for (const av of lv.avs) evs.push(av);
    else if (live) evs.push(lv);
  }

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
  const limit = maxMatches ?? (live ? 200 : 600);
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
      // Best-effort : sportcash getEvento expose parfois score / temps en live via scr/pl/min sur j.
      let liveMeta = null;
      if (live && j) {
        const hs = j.scr?.h ?? j.scoh ?? null;
        const as = j.scr?.a ?? j.scoa ?? null;
        const score = (hs != null && as != null) ? `${hs}-${as}` : (j.sco || null);
        const minute = j.min ?? j.minu ?? j.pl?.min ?? null;
        const period = j.pl?.per ?? j.per ?? null;
        liveMeta = { score, minute: Number.isFinite(minute) ? minute : null, period };
      }
      out.push({ id: e.id, home: e.home, away: e.away, league: e.league, start: e.start, __raw: { markets }, live: liveMeta });
    }
  }
  return out;
}
