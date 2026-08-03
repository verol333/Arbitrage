import { listPrematch, listLive } from './list.js';
import { fetchOddsWS } from './ws.js';
import { winFlatOdds } from './parse.js';

export default {
  key: '1win',
  label: '1win',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, sport = 'football' } = {}) {
    if (sport !== 'football' && sport !== 'tennis') return [];
    return live ? listLive(sport) : listPrematch(sport);
  },
  async getOdds(match) {
    const map = await fetchOddsWS([match.id]);
    const groups = map.get(match.id) || map.get(String(match.id));
    return groups ? winFlatOdds(groups, { home: match.home, away: match.away }) : {};
  },
  async getOddsBatch(matches) {
    if (!matches.length) return new Map();
    // Le WS 1win coupe si on lui envoie >~100 IDs (timeout de subscribe).
    // On chunk en lots de 60 avec un WS neuf par lot, puis on fusionne.
    const CHUNK = 60;
    const raw = new Map();
    for (let i = 0; i < matches.length; i += CHUNK) {
      const chunk = matches.slice(i, i + CHUNK).map((m) => m.id);
      const part = await fetchOddsWS(chunk);
      for (const [k, v] of part) raw.set(k, v);
    }
    const out = new Map();
    for (const m of matches) {
      const g = raw.get(m.id) || raw.get(String(m.id)) || raw.get(Number(m.id));
      out.set(m.id, g ? winFlatOdds(g, { home: m.home, away: m.away }) : {});
    }
    return out;
  },
};
