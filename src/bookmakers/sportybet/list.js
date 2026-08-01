// SportyBet listing : pagination /pcUpcomingEvents pour prématch, ou
// /liveOrPrematchEvents pour live. Chaque match embarque déjà ses `markets`.
import { sbFetchUpcoming, sbFetchLive, isVirtual } from './api.js';

function extractEvents(root) {
  if (!root) return [];
  const data = root.data;
  if (!data) return [];
  // Prématch : data.events[]
  if (Array.isArray(data.events)) return data.events;
  // Live : data[].events[] (groupé par tournament)
  if (Array.isArray(data)) {
    const out = [];
    for (const t of data) {
      const evs = Array.isArray(t?.events) ? t.events : [];
      for (const e of evs) {
        if (!e.competitionName) e.competitionName = t?.name || '';
        out.push(e);
      }
    }
    return out;
  }
  return [];
}

function toMatch(ev, live) {
  const home = ev?.homeTeamName || '';
  const away = ev?.awayTeamName || '';
  const league = ev?.sport?.category?.tournament?.name || ev?.competitionName || '';
  if (!home || !away) return null;
  if (isVirtual(`${home} ${away} ${league}`)) return null;

  // Extraire liveMeta si live
  let liveMeta = null;
  if (live) {
    const setScore = ev?.setScore || '';
    const [hs, as] = setScore.includes(':') ? setScore.split(':') : [null, null];
    const score = (hs != null && as != null) ? `${hs}-${as}` : null;
    const minute = ev?.playedSeconds ? Number(String(ev.playedSeconds).split(':')[0]) : null;
    const period = ev?.matchStatus || null;
    liveMeta = { score, minute: Number.isFinite(minute) ? minute : null, period };
  }

  return {
    id: String(ev.eventId || ev.id || ''),
    home, away, league,
    start: Number(ev?.estimateStartTime) || null,
    __raw: { markets: Array.isArray(ev?.markets) ? ev.markets : [] },
    live: liveMeta,
  };
}

export async function listPrematch({ maxPages = 5, pageSize = 200 } = {}) {
  const seen = new Set();
  const out = [];
  for (let p = 1; p <= maxPages; p++) {
    const data = await sbFetchUpcoming({ pageNum: p, pageSize });
    const events = extractEvents(data);
    if (!events.length) break;
    let added = 0;
    for (const ev of events) {
      const m = toMatch(ev, false);
      if (!m || seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
      added++;
    }
    if (added === 0) break;
  }
  console.log(`[sportybet] UPCOMING : ${out.length} matchs foot listés`);
  return out;
}

export async function listLive() {
  const data = await sbFetchLive();
  const events = extractEvents(data);
  const out = [];
  for (const ev of events) {
    // Filtre : uniquement les matchs status=1 (LIVE)
    if (ev?.status !== 1 && !/^(H1|H2|HT|LIVE)$/i.test(ev?.matchStatus || '')) continue;
    const m = toMatch(ev, true);
    if (m) out.push(m);
  }
  console.log(`[sportybet] LIVE : ${out.length} matchs foot listés`);
  return out;
}
