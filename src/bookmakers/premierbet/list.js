import { pget, isVirtual, isOutright, splitTeams } from './api.js';

// eventType=1 pour foot (validé via probe : "Inter Milan - AC Monza" a eventType=1).
// treatAsSport=1 est aussi un indicateur foot fiable.
const FOOT_EVENT_TYPES = new Set([1]);

export async function listMatches({ live = false, maxMatches = 300, horizonHours = 168 } = {}) {
  if (live) return [];
  const nowMs = Date.now();
  const horizonMs = nowMs + horizonHours * 3600 * 1000;
  const best = (await pget('market/events/bestsellers')) || [];
  const out = [];
  let seenFoot = 0, filteredOutright = 0, filteredVirtual = 0, filteredHorizon = 0, noTeams = 0;
  for (const e of best) {
    const isFoot = FOOT_EVENT_TYPES.has(e.eventType) || FOOT_EVENT_TYPES.has(e.treatAsSport);
    if (!isFoot) continue;
    seenFoot++;
    if (isOutright(e.eventName)) { filteredOutright++; continue; }
    const teams = splitTeams(e.eventName);
    if (!teams) { noTeams++; continue; }
    const leagueName = e.category3Name || e.category2Name || e.category1Name || '';
    if (isVirtual(`${teams.home} ${teams.away} ${leagueName}`)) { filteredVirtual++; continue; }
    if (!e.eventStart || e.eventStart <= nowMs + 2 * 60 * 1000 || e.eventStart > horizonMs) { filteredHorizon++; continue; }
    const markets = Array.isArray(e.eventGames) ? e.eventGames : [];
    out.push({
      id: String(e.eventId), home: teams.home, away: teams.away,
      league: leagueName, start: e.eventStart,
      __raw: { markets },
    });
    if (out.length >= maxMatches) break;
  }
  console.log(`[premierbet] bestsellers=${best.length} foot=${seenFoot} kept=${out.length} filtered=(outright:${filteredOutright} virtual:${filteredVirtual} horizon:${filteredHorizon} noTeams:${noTeams})`);
  return out;
}
