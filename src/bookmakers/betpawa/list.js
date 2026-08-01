// BetPawa foot listing : appel /events/lists/by-queries (protobuf) → extraction
// des match IDs. Les cotes viennent via getOdds → /events/{id} (JSON).
import { bpFetchList, buildEventsListUrl, isVirtual, splitTeams } from './api.js';

const MARKET_TYPE_IDS = new Set(['3743', '28000810', '28000850', '3744', '3745', '3746']);

export async function listMatches({ live = false, horizonHours = 168, maxMatches = 500 } = {}) {
  const eventType = live ? 'LIVE' : 'UPCOMING';
  const seen = new Set();
  const out = [];
  const PAGE = 100;

  for (let skip = 0; skip < maxMatches && skip < 2000; skip += PAGE) {
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

  console.log(`[betpawa] ${eventType} : ${out.length} matchs foot listés`);
  return out;
}
