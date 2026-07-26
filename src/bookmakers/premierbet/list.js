import { pget, isVirtual, isOutright, splitTeams } from './api.js';

const FOOT_EVENT_TYPES = new Set([1]);
// eventType=1 pas 100% fiable chez PremierBet (baseball MLB, tennis singles/doubles
// remontent parfois avec eventType=1). Filtre secondaire par nom de ligue + pattern
// des noms d'équipe (tennis doubles = "X / Y", baseball = catégorie contient MLB).
const NON_FOOT_LEAGUE_RE = /tennis|baseball|basketball|volleyball|hockey|mma|boxing|cricket|\bnfl\b|\bnba\b|\bnhl\b|\bmlb\b|table tennis|snooker|darts|handball|rugby|badminton|golf|esports?|counter.?strike|dota|starcraft|league of legends/i;

export async function listMatches({ live = false, maxMatches = 300, horizonHours = 168 } = {}) {
  if (live) return [];
  const nowMs = Date.now();
  const horizonMs = nowMs + horizonHours * 3600 * 1000;
  const best = (await pget('market/events/bestsellers')) || [];
  const out = [];
  let seenFoot = 0, filteredOutright = 0, filteredVirtual = 0, filteredHorizon = 0, noTeams = 0, filteredNonFoot = 0;
  for (const e of best) {
    const isFoot = FOOT_EVENT_TYPES.has(e.eventType) || FOOT_EVENT_TYPES.has(e.treatAsSport);
    if (!isFoot) continue;
    seenFoot++;
    if (isOutright(e.eventName)) { filteredOutright++; continue; }
    const teams = splitTeams(e.eventName);
    if (!teams) { noTeams++; continue; }
    // Doubles tennis : "Nom1 / Nom2 vs Nom3 / Nom4" → skip
    if (teams.home.includes(' / ') || teams.away.includes(' / ')) { filteredNonFoot++; continue; }
    const leagueName = e.category3Name || e.category2Name || e.category1Name || '';
    const allCategories = [e.category1Name, e.category2Name, e.category3Name].filter(Boolean).join(' ').toLowerCase();
    if (NON_FOOT_LEAGUE_RE.test(allCategories)) { filteredNonFoot++; continue; }
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
  console.log(`[premierbet] bestsellers=${best.length} foot=${seenFoot} kept=${out.length} filtered=(outright:${filteredOutright} virtual:${filteredVirtual} horizon:${filteredHorizon} noTeams:${noTeams} nonFoot:${filteredNonFoot})`);
  return out;
}
