// Liste matches PremierBet via nouveau backend sports-api.premierbet.com/cg/v1/events/featured
// Retourne 20 events avec markets INLINE (pas de fetch détail nécessaire).
import { fetchFeaturedFootball, isVirtual, isOutright, splitTeams } from './api.js';

export async function listMatches({ live = false, maxMatches = 300, horizonHours = 168 } = {}) {
  if (live) return [];
  const nowMs = Date.now();
  const horizonMs = nowMs + horizonHours * 3600 * 1000;
  const events = await fetchFeaturedFootball();
  const out = [];
  let filteredOutright = 0, filteredVirtual = 0, filteredHorizon = 0, noTeams = 0;
  for (const e of events) {
    const names = Array.isArray(e.eventNames) ? e.eventNames : [];
    if (names.length < 2) { noTeams++; continue; }
    const home = String(names[0] || '').trim();
    const away = String(names[1] || '').trim();
    if (!home || !away) { noTeams++; continue; }
    const combined = `${home} - ${away}`;
    if (isOutright(combined)) { filteredOutright++; continue; }
    if (isVirtual(combined)) { filteredVirtual++; continue; }
    const startTime = Number(e.startTime);
    if (!Number.isFinite(startTime) || startTime <= nowMs + 2 * 60 * 1000 || startTime > horizonMs) { filteredHorizon++; continue; }
    const markets = Array.isArray(e.markets) ? e.markets : [];
    out.push({
      id: String(e.id || e.providerId),
      home, away,
      league: '',
      start: startTime,
      __raw: { markets },
    });
    if (out.length >= maxMatches) break;
  }
  console.log(`[premierbet] featured=${events.length} kept=${out.length} filtered=(outright:${filteredOutright} virtual:${filteredVirtual} horizon:${filteredHorizon} noTeams:${noTeams})`);
  return out;
}
