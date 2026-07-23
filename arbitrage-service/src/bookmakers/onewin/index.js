// Interface commune 1win. Batch WebSocket : getOddsBatch charge N matchs en une
// seule session WS (scannée depuis matchCore.ts fetchWinOddsWS).
import { listPrematch, listLive } from './list.js';
import { fetchOddsWS } from './ws.js';
import { winFlatOdds } from './parse.js';

export default {
  key: '1win',
  label: '1win',
  supports: { prematch: true, live: true },
  async listMatches({ live = false } = {}) {
    return live ? listLive() : listPrematch();
  },
  // Utilisation solo (rare — préférez getOddsBatch).
  async getOdds(match) {
    const map = await fetchOddsWS([match.id]);
    const groups = map.get(match.id) || map.get(String(match.id));
    return groups ? winFlatOdds(groups, { home: match.home, away: match.away }) : {};
  },
  // Optimisation : lit toutes les cotes en une seule session WebSocket.
  async getOddsBatch(matches) {
    if (!matches.length) return new Map();
    const ids = matches.map((m) => m.id);
    const raw = await fetchOddsWS(ids);
    const out = new Map();
    for (const m of matches) {
      const g = raw.get(m.id) || raw.get(String(m.id)) || raw.get(Number(m.id));
      out.set(m.id, g ? winFlatOdds(g, { home: m.home, away: m.away }) : {});
    }
    return out;
  },
};
