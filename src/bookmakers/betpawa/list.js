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

  // Enrichit startTime via /events/{id} en parallèle. Batch 15 pour ne pas
  // saturer le serveur BetPawa (batch 40 → timeouts massifs). Timeout 25s.
  // Sans start, les matchs sont exclus du prématch (matching.js requireStart)
  // → il faut absolument l'obtenir pour BetPawa (protobuf ne le fournit pas).
  const BATCH = 15;
  for (let i = 0; i < out.length; i += BATCH) {
    const chunk = out.slice(i, i + BATCH);
    await Promise.all(chunk.map(async (m) => {
      try {
        const ev = await bpFetchEvent(m.id, 25_000);
        const ts = Number(ev?.startTime);
        if (Number.isFinite(ts) && ts > 0) m.start = ts;
        if (ev?.competitionName) m.league = ev.competitionName;
      } catch { /* silencieux — start reste null (match exclu du prématch) */ }
    }));
  }

  const withStart = out.filter((m) => m.start).length;
  console.log(`[betpawa] ${eventType} : ${out.length} matchs foot listés (${withStart} avec startTime)`);
  return out;
}
