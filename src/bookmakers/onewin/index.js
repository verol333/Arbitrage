import { listPrematch, listLive } from './list.js';
import { fetchOddsWS } from './ws.js';
import { winFlatOdds, winTennisFlatOdds, winBasketFlatOdds } from './parse.js';

export default {
  key: '1win',
  label: '1win',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, sport = 'football' } = {}) {
    if (!['football', 'tennis', 'basket', 'hockey', 'volleyball'].includes(sport)) return [];
    return live ? listLive(sport) : listPrematch(sport);
  },
  async getOdds(match, opts = {}) {
    const map = await fetchOddsWS([match.id]);
    const groups = map.get(match.id) || map.get(String(match.id)) || map.get(Number(match.id));
    if (!groups) return {};
    // Volleyball : structure sets identique tennis (Winner 2-way + s1/s2/s3 winner
    // + Handicap points + Total points + Nth set Handicap/Total). winTennisFlatOdds
    // gere les noms "Winner", "Handicap", "Total", "Nth set. ...".
    const flat = opts.sport === 'tennis' || opts.sport === 'volleyball' ? winTennisFlatOdds
               : opts.sport === 'basket' ? winBasketFlatOdds
               : winFlatOdds;
    return flat(groups, { home: match.home, away: match.away });
  },
  async getOddsBatch(matches, opts = {}) {
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
    // Volleyball : structure sets identique tennis.
    const flat = opts.sport === 'tennis' || opts.sport === 'volleyball' ? winTennisFlatOdds
               : opts.sport === 'basket' ? winBasketFlatOdds
               : winFlatOdds;
    for (const m of matches) {
      const g = raw.get(m.id) || raw.get(String(m.id)) || raw.get(Number(m.id));
      out.set(m.id, g ? flat(g, { home: m.home, away: m.away }) : {});
    }
    return out;
  },
};
