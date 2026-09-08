import { listPrematch, listLive } from './list.js';
import { lnbpariFlatOdds } from './parse.js';
import { feedInvoke } from './api.js';

// Les marches se lisent par LOT d'identifiants de match : un seul abonnement
// GetMarketsByEventIds couvre plusieurs matchs. On limite la taille du lot pour
// que le lot initial tienne dans la fenetre de silence.
const CHUNK = 25;

async function readMarkets(ids) {
  const calls = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    calls.push({ target: 'GetMarketsByEventIds', args: [ids.slice(i, i + CHUNK), null, {}] });
  }
  const byEvent = new Map();
  // 8 abonnements par session au maximum : au-dela le flux devient bavard et le
  // silence de fin n'arrive jamais.
  for (let i = 0; i < calls.length; i += 8) {
    const res = await feedInvoke(calls.slice(i, i + 8), { timeoutMs: 30_000 });
    for (const rows of res.values()) {
      for (const m of rows) {
        const id = m.key && m.key.eventId;
        if (!id) continue;
        if (!byEvent.has(id)) byEvent.set(id, []);
        byEvent.get(id).push(m);
      }
    }
  }
  return byEvent;
}

export default {
  key: 'lnbpari',
  label: 'LNB Pari',
  // Flux "direct-feed" (BetLab) de lnbpari.com : joignable en direct depuis les
  // runners GitHub, sans compte ni Cloudflare. Pre-match ET direct, foot.
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    if (sport !== 'football') return [];
    return live ? listLive(sport) : listPrematch(horizonHours, sport);
  },
  async getOdds(match, { sport = 'football' } = {}) {
    if (sport !== 'football') return {};
    const byEvent = await readMarkets([String(match.id)]);
    return lnbpariFlatOdds(byEvent.get(String(match.id)) || []);
  },
  async getOddsBatch(matches, { sport = 'football' } = {}) {
    const out = new Map();
    if (sport !== 'football' || !matches.length) return out;
    const byEvent = await readMarkets(matches.map((m) => String(m.id)));
    for (const m of matches) out.set(m.id, lnbpariFlatOdds(byEvent.get(String(m.id)) || []));
    return out;
  },
};
