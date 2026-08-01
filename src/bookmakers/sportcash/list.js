import { xget, parseTs, splitTeams, isVirtual } from './api.js';
import { sportcashFlatOdds } from './parse.js';

// Label 'ds' expose par Sportcash pour chaque sport. Verifie via widget dump.
const SPORT_LABELS = { football: 'Football', tennis: 'Tennis' };

async function listSportEvents(live, sportLabel) {
  const [wc, hl] = await Promise.all([
    xget('getWidgetCentrali', {}),
    xget('getHomeLandingData', { timezone: '1' }),
  ]);
  const evs = [];
  // getWidgetCentrali.bws : widgets banners → chacun a .avs (top events).
  if (wc?.bws) for (const bw of wc.bws) for (const av of (bw.avs || [])) evs.push(av);
  // getWidgetCentrali.tms : top matches promus.
  if (wc?.tms) for (const tm of wc.tms) evs.push(tm);
  // getWidgetCentrali.lms : catalogue par sport ID (1=Foot, 2=Bk, etc.).
  // Chaque bucket peut exposer plusieurs listes : avs (all), tms (top),
  // hmv (highlights), hgevs (highest odds). On collecte tout — l'audit
  // probe-sportcash-catalog a montre 20 events Football alors qu'on n'en
  // extrayait que 3-7 avec .avs seul.
  if (wc?.lms) for (const sportKey of Object.keys(wc.lms)) {
    const bucket = wc.lms[sportKey];
    for (const listKey of ['avs', 'tms', 'hmv', 'hgevs', 'lvs', 'evs']) {
      const list = bucket?.[listKey];
      if (Array.isArray(list)) for (const e of list) evs.push(e);
    }
  }
  // getWidgetCentrali.hgevs / mpe : highest odds events / main promoted events.
  for (const topKey of ['hgevs', 'mpe']) {
    const list = wc?.[topKey];
    if (Array.isArray(list)) for (const e of list) evs.push(e);
    else if (list && typeof list === 'object') {
      for (const bucket of Object.values(list)) {
        if (Array.isArray(bucket)) for (const e of bucket) evs.push(e);
        else if (Array.isArray(bucket?.avs)) for (const e of bucket.avs) evs.push(e);
      }
    }
  }
  // getHomeLandingData.tms / lvs : top et live.
  if (hl?.tms) for (const tm of hl.tms) evs.push(tm);
  if (hl?.lvs) for (const lv of hl.lvs) {
    if (lv?.avs) for (const av of lv.avs) evs.push(av);
    else if (live) evs.push(lv);
  }

  const seen = new Set(); const out = [];
  for (const e of evs) {
    if (e.ds !== sportLabel) continue;
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

export async function listMatches({ live = false, maxMatches, horizonHours = 72, sport = 'football' } = {}) {
  const sportLabel = SPORT_LABELS[sport];
  if (!sportLabel) return [];
  const limit = maxMatches ?? (live ? 200 : 600);
  const nowMs = Date.now();
  const horizonMs = nowMs + horizonHours * 3600 * 1000;
  let events = await listSportEvents(live, sportLabel);
  if (!live) events = events.filter((e) => e.start && e.start > nowMs + 2 * 60 * 1000 && e.start <= horizonMs);
  events = events.slice(0, limit);
  if (!events.length) return [];

  // Sportcash rate-limite quand on tape trop vite : BATCH=12 → tous les
  // getEvento renvoyaient null (0 cotes lues systématiquement en scan).
  // BATCH=4 + petite pause entre chunks résout le silencieux.
  const BATCH = 4;
  const SLEEP_BETWEEN_CHUNKS_MS = 250;
  let ok = 0, empty = 0;
  const out = [];
  for (let i = 0; i < events.length; i += BATCH) {
    const chunk = events.slice(i, i + BATCH);
    // Sportcash bug : en live, getEvento(isLive:true) retourne 0 markets
    // (vérifié via probe). isLive:false retourne 105 markets sur le même match
    // (les cotes sont bien là). On force isLive:false pour tous les modes.
    const results = await Promise.all(chunk.map((e) =>
      xget('getEvento', { pal: String(e.p), avv: String(e.a), idAggregata: '-1', isLive: 'false' }, 15_000),
    ));
    for (let k = 0; k < chunk.length; k++) {
      const e = chunk[k];
      const j = results[k];
      const markets = j && Array.isArray(j.scs) ? j.scs : [];
      if (markets.length) ok++; else empty++;
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
      out.push({ id: e.id, home: e.home, away: e.away, league: e.league, start: e.start,
        __raw: { markets, pal: e.p, avv: e.a }, live: liveMeta });
    }
    if (i + BATCH < events.length) await new Promise((r) => setTimeout(r, SLEEP_BETWEEN_CHUNKS_MS));
  }
  // Distribution des tailles de raw + cs codes distincts sur premier match ok
  const rawSizes = out.map((m) => (m.__raw?.markets || []).length);
  const parsedSizes = out.map((m) => Object.keys(sportcashFlatOdds(m.__raw?.markets || [])).length);
  const firstOk = out.find((m) => (m.__raw?.markets || []).length > 0);
  const firstCsSample = firstOk ? [...new Set((firstOk.__raw.markets || []).map((m) => m.cs))].slice(0, 20) : [];
  console.log(`[sportcash:${sport}] getEvento: ${ok} ok / ${empty} empty / ${events.length} total | raw=${JSON.stringify(rawSizes)} parsed=${JSON.stringify(parsedSizes)} first_cs=${JSON.stringify(firstCsSample)}`);
  return out;
}
