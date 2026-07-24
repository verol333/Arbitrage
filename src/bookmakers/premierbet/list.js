import { pget, isVirtual, isOutright, splitTeams } from './api.js';

const SPORT_CATS = { football: 'Soccer', tennis: 'Tennis' };

export async function listMatches({ live = false, maxMatches = 200, horizonHours = 72, sport = 'football' } = {}) {
  if (live) return [];
  const catName = SPORT_CATS[sport] || SPORT_CATS.football;
  const nowMs = Date.now();
  const horizonMs = nowMs + horizonHours * 3600 * 1000;
  const best = (await pget('market/events/bestsellers')) || [];
  const out = [];
  for (const e of best) {
    if (e.category1Name !== catName || isOutright(e.eventName)) continue;
    const teams = splitTeams(e.eventName);
    if (!teams || isVirtual(`${teams.home} ${teams.away} ${e.category3Name || ''}`)) continue;
    if (!e.eventStart || e.eventStart <= nowMs + 2 * 60 * 1000 || e.eventStart > horizonMs) continue;
    const markets = Array.isArray(e.eventGames) ? e.eventGames : [];
    out.push({
      id: String(e.eventId), home: teams.home, away: teams.away,
      league: e.category3Name || e.category2Name || '', start: e.eventStart,
      __raw: { markets },
    });
    if (out.length >= maxMatches) break;
  }
  return out;
}
