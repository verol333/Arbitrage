// BetPawa foot listing : appel /events/lists/by-queries (protobuf) → extraction
// des match IDs. Le protobuf ne fournit pas le startTime → on l'enrichit via
// /events/{id} en parallèle (batch 40). Sans start, alignCatalogs rejette le
// candidat en mode prématch (évite les fake arbs sur matchs déjà live).
import { bpFetchList, buildEventsListUrl, isVirtual, splitTeams, CATEGORY_IDS } from './api.js';

const MARKET_TYPE_IDS = new Set(['3743', '28000810', '28000850', '3744', '3745', '3746']);

export async function listMatches({ live = false, sport = 'football' } = {}) {
  const category = CATEGORY_IDS[sport];
  if (!category) return [];
  const eventType = live ? 'LIVE' : 'UPCOMING';
  const seen = new Set();
  const out = [];
  const PAGE = 100;
  const HARD_CAP = 2000;

  for (let skip = 0; skip < HARD_CAP; skip += PAGE) {
    const url = buildEventsListUrl({ eventType, categories: [category], skip, take: PAGE });
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

  // Note : le protobuf BetPawa ne fournit pas de startTime. Fetch /events/{id}
  // pour l'obtenir est trop lent (1000+ requêtes, timeouts massifs même avec
  // batch réduit). À la place, matching.js accepte les candidats sans start
  // uniquement si teamSim > 0.90 — élimine les faux appariements sans coût.
  console.log(`[betpawa:${sport}] ${eventType} : ${out.length} matchs listés (sans startTime)`);
  return out;
}
