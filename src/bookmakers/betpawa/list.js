// BetPawa foot listing : appel /events/lists/by-queries (protobuf) → extraction
// des match IDs. Le protobuf ne fournit pas le startTime → on l'enrichit via
// /events/{id} en parallèle (batch 40). Sans start, alignCatalogs rejette le
// candidat en mode prématch (évite les fake arbs sur matchs déjà live).
import { bpFetchList, bpFetchEvent, buildEventsListUrl, isVirtual, splitTeams } from './api.js';

const MARKET_TYPE_IDS = new Set(['3743', '28000810', '28000850', '3744', '3745', '3746']);

export async function listMatches({ live = false } = {}) {
  const eventType = live ? 'LIVE' : 'UPCOMING';
  const seen = new Set();
  const out = [];
  const PAGE = 100;
  const HARD_CAP = 2000;

  for (let skip = 0; skip < HARD_CAP; skip += PAGE) {
    const url = buildEventsListUrl({ eventType, skip, take: PAGE });
    const strings = await bpFetchList(url);
    if (!strings.length) break;

    let added = 0;
    for (let i = 0; i < strings.length; i++) {
      const s = strings[i];
      if (!/^\d{7,10}$/.test(s)) continue;
      if (MARKET_TYPE_IDS.has(s)) continue;
      const name = strings[i + 1] || '';
      if (!name.includes(' - ') || /1X2|UP|LIVE|UPCOMING|FT$/.test(name)) continue;
      const teams = splitTeams(name);
      if (!teams) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      if (isVirtual(`${teams.home} ${teams.away}`)) continue;

      out.push({
        id: s,
        home: teams.home,
        away: teams.away,
        league: '',
        start: null,
      });
      added++;
    }
    if (added === 0) break;
  }

  // Enrichit startTime via /events/{id} en parallèle (batch 40).
  // Le protobuf ne le fournit pas — sans start, les matchs BetPawa sont exclus
  // du prématch (voir matching.js requireStart) → il faut absolument l'obtenir.
  const BATCH = 40;
  for (let i = 0; i < out.length; i += BATCH) {
    const chunk = out.slice(i, i + BATCH);
    await Promise.all(chunk.map(async (m) => {
      try {
        const ev = await bpFetchEvent(m.id, 10_000);
        const ts = Number(ev?.startTime);
        if (Number.isFinite(ts) && ts > 0) m.start = ts;
        // Récupère aussi le nom de compétition et l'état live pour information
        if (ev?.competitionName) m.league = ev.competitionName;
      } catch { /* silencieux — le match reste avec start=null (exclu prématch) */ }
    }));
  }

  const withStart = out.filter((m) => m.start).length;
  console.log(`[betpawa] ${eventType} : ${out.length} matchs foot listés (${withStart} avec startTime)`);
  return out;
}
