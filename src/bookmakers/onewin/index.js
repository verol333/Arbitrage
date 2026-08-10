import { listPrematch, listLive } from './list.js';
import { fetchOddsWS } from './ws.js';
import { winFlatOdds, winTennisFlatOdds, winBasketFlatOdds } from './parse.js';

export default {
  key: '1win',
  label: '1win',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, sport = 'football' } = {}) {
    if (!['football', 'tennis', 'basket', 'hockey'].includes(sport)) return [];
    return live ? listLive(sport) : listPrematch(sport);
  },
  async getOdds(match, opts = {}) {
    const map = await fetchOddsWS([match.id]);
    // Bug fix : la Map WS stocke souvent matchId en Number (b.data.matchId
    // vient direct du JSON API). Le singleton oubliait le fallback Number
    // (present dans getOddsBatch), ce qui produisait des re-fetch a vide sur
    // certains matchs. Aligne les 3 tentatives comme getOddsBatch.
    const groups = map.get(match.id) || map.get(String(match.id)) || map.get(Number(match.id));
    if (!groups) return {};
    // Hockey utilise le meme format 3-way regulation que foot (winner
    // 1X2 + total + hcp) — routage vers winFlatOdds jusqu'a probe cross-book.
    const flat = opts.sport === 'tennis' ? winTennisFlatOdds
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
    // Hockey utilise le meme format 3-way regulation que foot (winner
    // 1X2 + total + hcp) — routage vers winFlatOdds jusqu'a probe cross-book.
    const flat = opts.sport === 'tennis' ? winTennisFlatOdds
               : opts.sport === 'basket' ? winBasketFlatOdds
               : winFlatOdds;
    for (const m of matches) {
      const g = raw.get(m.id) || raw.get(String(m.id)) || raw.get(Number(m.id));
      out.set(m.id, g ? flat(g, { home: m.home, away: m.away }) : {});
    }
    return out;
  },
};
