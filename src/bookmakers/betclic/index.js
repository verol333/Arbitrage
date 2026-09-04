import { listBetclic } from './list.js';
import { bcMatchMarkets, bcMatchMarketsBatch } from './api.js';
import { betclicFlatOdds } from './parse.js';

// Betclic (backend gRPC-web offering.begmedia.com, regulation CI) : lu via le
// RELAIS Base44 (voir api.js — les IP GitHub sont refusees en HTTP 464).
// Foot pre-match seulement (voir list.js pour le direct).
const RELAY_CHUNK = 12; // plafond du relais : 12 matchs par appel

function toOdds(markets, match) {
  if (!markets?.length) return {};
  const odds = betclicFlatOdds(markets, { home: match.home, away: match.away });
  for (const meta of Object.values(odds._ids || {})) meta.match_id = String(match.id);
  return odds;
}

export default {
  key: 'betclic',
  label: 'Betclic',
  supports: { prematch: true, live: false },
  async listMatches({ sport = 'football', live = false, horizonHours = 72 } = {}) {
    if (sport !== 'football' || live) return [];
    return listBetclic({ sport, live, horizonHours });
  },
  async getOdds(match, { sport = 'football', live = false } = {}) {
    if (sport !== 'football' || live) return {};
    return toOdds(await bcMatchMarkets(match.id, { regulation: 'CI' }), match);
  },
  // Lecture groupee : un seul appel relais pour 12 matchs, avec plusieurs lots
  // en parallele — indispensable pour tenir dans le budget temps du scan.
  async getOddsBatch(matches, { sport = 'football', live = false } = {}) {
    const out = new Map();
    if (sport !== 'football' || live) return out;
    const chunks = [];
    for (let i = 0; i < matches.length; i += RELAY_CHUNK) chunks.push(matches.slice(i, i + RELAY_CHUNK));
    const WAVE = 4;
    for (let i = 0; i < chunks.length; i += WAVE) {
      const wave = chunks.slice(i, i + WAVE);
      const res = await Promise.all(
        wave.map((c) => bcMatchMarketsBatch(c.map((m) => m.id), { regulation: 'CI' }).catch(() => ({}))),
      );
      wave.forEach((c, k) => {
        for (const m of c) out.set(m.id, toOdds(res[k]?.[String(m.id)] || [], m));
      });
    }
    return out;
  },
};
