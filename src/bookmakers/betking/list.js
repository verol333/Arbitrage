// Catalogue BetKing : menu (pays → compétitions) puis flux par compétition.
import { jget } from './api.js';

const MAX_LEAGUES = 14;
let cache = { at: 0, rows: [] };

export async function listBetking({ force = false, maxLeagues = MAX_LEAGUES } = {}) {
  if (!force && cache.rows.length && Date.now() - cache.at < 120_000) return cache.rows;

  const menu = await jget('/api/feeds/prematch/matches/custommenu/en/4');
  const foot = (menu?.Sports || []).find((s) => Number(s.SportID) === 1);
  const tours = [];
  for (const cat of foot?.Category || []) {
    for (const t of cat.Tournaments || []) {
      if ((Number(t.ItemEventCount) || 0) > 0) {
        tours.push({ id: Number(t.ItemID), name: String(t.ItemName || ''), cat: String(cat.ItemName || ''), events: Number(t.ItemEventCount) || 0 });
      }
    }
  }
  tours.sort((a, b) => b.events - a.events);

  const rows = [];
  const seen = new Set();
  for (const t of tours.slice(0, maxLeagues)) {
    const feed = await jget(`/api/feeds/prematch/en/1/${t.id}/0/0`);
    for (const area of feed?.AreaMatches || []) {
      for (const it of area.Items || []) {
        const id = Number(it.ItemID);
        if (!id || seen.has(id)) continue;
        const collections = Array.isArray(it.OddsCollection) ? it.OddsCollection : [];
        if (!collections.some((c) => (c.MatchOdds || []).length)) continue;
        seen.add(id);
        const teams = Array.isArray(it.Teams) ? it.Teams : [];
        const name = String(it.ItemName || '');
        const parts = name.split(' - ');
        const start = Date.parse(String(it.ItemDate || '')) || 0;
        if (!start) continue;
        rows.push({
          id,
          home: String(teams[0]?.Name || parts[0] || '').trim(),
          away: String(teams[1]?.Name || parts.slice(1).join(' - ') || '').trim(),
          league: String(it.TournamentName || t.name || 'BetKing').trim(),
          country: String(it.CategoryName || t.cat || '').trim(),
          tournament_id: Number(it.TournamentId) || t.id,
          start,
          collections,
        });
      }
    }
  }

  if (rows.length) cache = { at: Date.now(), rows };
  return rows;
}
