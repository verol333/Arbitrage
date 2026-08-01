// BetPawa foot listing + odds extraction via protobuf + float scan.
import { bpFetchProtobuf, buildEventsUrl, isVirtual, splitTeams, extractFloats } from './api.js';

const MARKET_TYPE_IDS = new Set(['3743', '28000810', '28000850', '3744', '3745', '3746']);

export async function listMatches({ live = false, horizonHours = 168, maxMatches = 500 } = {}) {
  const eventType = live ? 'LIVE' : 'UPCOMING';
  const seen = new Set();
  const out = [];
  const PAGE = 100;

  for (let skip = 0; skip < maxMatches && skip < 2000; skip += PAGE) {
    const url = buildEventsUrl({ eventType, skip, take: PAGE });
    const dump = await bpFetchProtobuf(url);
    if (!dump?.strings?.length) break;
    const { strings, positions, buf } = dump;

    let added = 0;
    for (let i = 0; i < strings.length; i++) {
      const s = strings[i];
      // ID match : 7-10 chiffres, NON dans les market type IDs
      if (!/^\d{7,10}$/.test(s)) continue;
      if (MARKET_TYPE_IDS.has(s)) continue;
      const name = strings[i + 1] || '';
      if (!name.includes(' - ') || /1X2|UP|LIVE|UPCOMING|FT$/.test(name)) continue;
      const teams = splitTeams(name);
      if (!teams) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      if (isVirtual(`${teams.home} ${teams.away}`)) continue;

      // Cherche "1X2 - FT" dans les ~40 strings suivantes → puis extrait
      // 3 floats après cette position dans le buffer.
      let odds = [];
      for (let j = i; j < Math.min(i + 40, strings.length); j++) {
        if (strings[j] === '1X2 - FT' || strings[j] === '1X2') {
          const marketPos = positions[j] + strings[j].length;
          const floats = extractFloats(buf, marketPos, 200, 3);
          if (floats.length === 3) {
            // Filtrer : les 3 floats doivent avoir des positions séparées (pas
            // le même 4-byte overlap) et cohérentes cotes 1X2 (somme des
            // inverses < 1.15 pour éviter faux positifs).
            const positionsUnique = floats.map(f => f.pos);
            const spread = Math.max(...positionsUnique) - Math.min(...positionsUnique);
            if (spread >= 12 && spread <= 100) {
              const sum = floats.reduce((a, b) => a + 1 / b.value, 0);
              if (sum > 0.85 && sum < 1.30) {
                odds = floats.map(f => f.value);
                break;
              }
            }
          }
        }
      }

      out.push({
        id: s, home: teams.home, away: teams.away, league: '',
        start: null,
        __raw: { odds },
      });
      added++;
    }
    if (added === 0) break;
  }

  const withOdds = out.filter(m => m.__raw.odds.length === 3).length;
  console.log(`[betpawa] ${eventType} : ${out.length} matchs foot (${withOdds} avec cotes 1X2 extraites)`);
  return out;
}
