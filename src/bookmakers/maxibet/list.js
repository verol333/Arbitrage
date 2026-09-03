// Liste des matchs MaxiBet. Les marchés arrivent DANS la même réponse que les
// matchs : ils sont conservés dans __raw pour que getOdds ne relise rien.
import { fetchCompetitions, fetchGames } from './api.js';

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

export async function listPrematch(horizonHours = 72, sport = 'football') {
  const comps = await fetchCompetitions(sport);
  if (!comps.length) return [];
  const rows = await fetchGames(sport, comps.map((c) => c.id));
  const now = Date.now() / 1000;
  const max = now + horizonHours * 3600;
  const out = [];
  for (const r of rows) {
    const ts = Number(r.game.start_ts);
    if (!Number.isFinite(ts) || ts > max) continue;
    const home = clean(r.game.team1_name);
    const away = clean(r.game.team2_name);
    if (!home || !away) continue;
    out.push({
      id: String(r.game.id),
      home,
      away,
      league: clean(r.comp.name),
      start: new Date(ts * 1000).toISOString(),
      __raw: { markets: r.markets },
    });
  }
  return out;
}
