import { feed } from './api.js';

// BetKing (Nigeria) : foot pré-match uniquement. Les cotes arrivent déjà au
// vocabulaire standard (source : cache de l'application, rempli par un vrai
// navigateur). Aucun compte, aucune authentification.
export default {
  key: 'betking',
  label: 'BetKing',
  supports: { prematch: true, live: false },

  async listMatches({ live = false, sport = 'football', horizonHours } = {}) {
    if (live || sport !== 'football') return [];
    const rows = await feed(horizonHours || 72).catch(() => []);
    return rows
      .filter((m) => m && m.id && m.home && m.away && m.start)
      .map((m) => ({
        id: m.id,
        home: m.home,
        away: m.away,
        league: String(m.league || 'BetKing').trim(),
        start: m.start,
      }));
  },

  async getOdds(match) {
    const rows = await feed(72).catch(() => []);
    const hit = rows.find((r) => Number(r.id) === Number(match && match.id));
    if (!hit) return {};
    return { ...(hit.odds || {}), _ids: hit.ids || {} };
  },
};
