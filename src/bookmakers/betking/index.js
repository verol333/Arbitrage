import { listBetking, closeBetking } from './list.js';
import { betkingOdds } from './parse.js';

// BetKing (Nigeria) : foot pré-match uniquement. Cotes lues directement sur le
// site, depuis un vrai navigateur lancé ici (voir api.js). Aucun compte.
export default {
  key: 'betking',
  label: 'BetKing',
  supports: { prematch: true, live: false },

  async listMatches({ live = false, sport = 'football', horizonHours } = {}) {
    if (live || sport !== 'football') return [];
    const horizon = Date.now() + (horizonHours || 72) * 3600 * 1000;
    const rows = await listBetking().catch(() => []);
    return rows
      .filter((m) => m.start > Date.now() - 15 * 60_000 && m.start < horizon)
      .map((m) => ({
        id: m.id,
        home: m.home,
        away: m.away,
        league: m.league,
        start: new Date(m.start).toISOString(),
      }));
  },

  // Cotes capturées au listage : le flux BetKing ne change pas au quart d'heure.
  // `noCache` (confirmation juste avant envoi) force une relecture du catalogue.
  async getOdds(match, { noCache = false } = {}) {
    const rows = await listBetking({ force: noCache }).catch(() => []);
    const hit = rows.find((r) => Number(r.id) === Number(match?.id));
    if (!hit) return {};
    const { odds, ids } = betkingOdds(hit);
    return { ...odds, _ids: ids };
  },

  close: closeBetking,
};
