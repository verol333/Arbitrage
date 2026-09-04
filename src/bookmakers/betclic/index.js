import { listBetclic } from './list.js';
import { bcMatchMarkets, bcMatchMarketsBatch } from './api.js';
import { betclicFlatOdds } from './parse.js';
import { betclicTennisFlatOdds } from './parseTennis.js';
import { betclicBasketFlatOdds } from './parseBasket.js';
import { betclicHockeyFlatOdds } from './parseHockey.js';
import { betclicVolleyballFlatOdds } from './parseVolleyball.js';

// Betclic (backend gRPC-web offering.begmedia.com, regulation CI) : lu via le
// RELAIS Base44 (voir api.js — les IP GitHub sont refusees en HTTP 464).
// Pre-match uniquement (voir list.js pour le direct). Sports lus : foot,
// tennis, basket, hockey, volley. Le relais expose deja les slugs correspondants.
const RELAY_CHUNK = 12; // plafond du relais : 12 matchs par appel
const SUPPORTED = ['football', 'tennis', 'basket', 'hockey', 'volleyball'];

function parserFor(sport) {
  if (sport === 'tennis') return betclicTennisFlatOdds;
  if (sport === 'basket') return betclicBasketFlatOdds;
  if (sport === 'hockey') return betclicHockeyFlatOdds;
  if (sport === 'volleyball') return betclicVolleyballFlatOdds;
  return betclicFlatOdds; // football
}

function toOdds(markets, match, sport) {
  if (!markets?.length) return {};
  const odds = parserFor(sport)(markets, { home: match.home, away: match.away });
  for (const meta of Object.values(odds._ids || {})) meta.match_id = String(match.id);
  return odds;
}

export default {
  key: 'betclic',
  label: 'Betclic',
  supports: { prematch: true, live: false },
  async listMatches({ sport = 'football', live = false, horizonHours = 72 } = {}) {
    if (live || !SUPPORTED.includes(sport)) return [];
    return listBetclic({ sport, live, horizonHours });
  },
  async getOdds(match, { sport = 'football', live = false } = {}) {
    if (live || !SUPPORTED.includes(sport)) return {};
    return toOdds(await bcMatchMarkets(match.id, { regulation: 'CI' }), match, sport);
  },
  // Lecture groupee : un seul appel relais pour 12 matchs, avec plusieurs lots
  // en parallele — indispensable pour tenir dans le budget temps du scan.
  async getOddsBatch(matches, { sport = 'football', live = false } = {}) {
    const out = new Map();
    if (live || !SUPPORTED.includes(sport)) return out;
    const chunks = [];
    for (let i = 0; i < matches.length; i += RELAY_CHUNK) chunks.push(matches.slice(i, i + RELAY_CHUNK));
    const WAVE = 4;
    for (let i = 0; i < chunks.length; i += WAVE) {
      const wave = chunks.slice(i, i + WAVE);
      const res = await Promise.all(
        wave.map((c) => bcMatchMarketsBatch(c.map((m) => m.id), { regulation: 'CI' }).catch(() => ({}))),
      );
      wave.forEach((c, k) => {
        for (const m of c) out.set(m.id, toOdds(res[k]?.[String(m.id)] || [], m, sport));
      });
    }
    return out;
  },
};
