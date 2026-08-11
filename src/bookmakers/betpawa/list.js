// BetPawa foot listing : appel /events/lists/by-queries (protobuf) → extraction
// des match IDs. Le protobuf ne fournit pas le startTime → on l'enrichit via
// /events/{id} UNIQUEMENT pour les matchs ambigus (doublons de noms) — fix
// bug user Dundee (Wom) vs Aberdeen (Wom) : BetPawa exposait 2 matchs feminins
// identiques (SWPL Cup + friendly), les 2 sans start/league → matching random.
import { bpFetchList, bpFetchEvent, buildEventsListUrl, isVirtual, splitTeams, CATEGORY_IDS, MARKET_TYPES_BY_SPORT } from './api.js';

const MARKET_TYPE_IDS = new Set(['3743', '28000810', '28000850', '3744', '3745', '3746', '3774', '2043818']);

export async function listMatches({ live = false, sport = 'football' } = {}) {
  const category = CATEGORY_IDS[sport];
  if (!category) return [];
  const marketTypes = MARKET_TYPES_BY_SPORT[sport] || MARKET_TYPES_BY_SPORT.football;
  const eventType = live ? 'LIVE' : 'UPCOMING';
  const seen = new Set();
  const out = [];
  const PAGE = 100;
  const HARD_CAP = 2000;

  for (let skip = 0; skip < HARD_CAP; skip += PAGE) {
    const url = buildEventsListUrl({ eventType, categories: [category], marketTypes, skip, take: PAGE });
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

  // ENRICHISSEMENT CIBLE des matchs AMBIGUS : plusieurs matchs avec la meme
  // paire (home,away) → on fetch /events/{id} pour recuperer startTime + league
  // et distinguer lequel est le vrai match SWPL Cup vs friendly. Sinon 2 matchs
  // "Dundee (Wom) vs Aberdeen (Wom)" indiscernables → matching random → fake arb.
  // Fetch UNIQUEMENT les doublons (typiquement 0-20 matchs sur 1000) → cost tres
  // faible vs enrichir toute la liste. Non-doublons gardent start=null (matching.js
  // les accepte via sim >= 0.90).
  const normKey = (h, a) => `${String(h || '').toLowerCase().replace(/\s+/g, '')}|${String(a || '').toLowerCase().replace(/\s+/g, '')}`;
  const groups = new Map(); // key → [match]
  for (const m of out) {
    const k = normKey(m.home, m.away);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  const duplicates = [];
  for (const [, matches] of groups) {
    if (matches.length >= 2) duplicates.push(...matches);
  }
  if (duplicates.length) {
    console.log(`[betpawa:${sport}] enrichissement ${duplicates.length} matchs ambigus (doublons noms)`);
    // Fetch parallele avec batch limite (evite timeouts betpawa)
    const BATCH = 20;
    for (let i = 0; i < duplicates.length; i += BATCH) {
      const chunk = duplicates.slice(i, i + BATCH);
      await Promise.all(chunk.map(async (m) => {
        const ev = await bpFetchEvent(m.id, 8_000, { fresh: false });
        if (!ev) return;
        // Extraction startTime et league depuis l'event JSON
        // Structure BetPawa : { startTime: "2026-08-05T19:30:00Z", competitionName, categoryName, ...}
        if (ev.startTime) {
          const t = Date.parse(ev.startTime);
          if (Number.isFinite(t)) m.start = t;
        }
        m.league = ev.competitionName || ev.category?.name || ev.competition?.name || '';
      }));
    }
    const enriched = duplicates.filter(m => m.start || m.league).length;
    console.log(`[betpawa:${sport}] ${enriched}/${duplicates.length} matchs ambigus enrichis (start ou league)`);
  }
  console.log(`[betpawa:${sport}] ${eventType} : ${out.length} matchs listés (${duplicates.length} enrichis)`);
  return out;
}
