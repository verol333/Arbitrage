import { listPrematch, listLive } from './list.js';
import { yellowbetFlatOdds } from './parse.js';
import { evapi } from './api.js';

// Re-fetch FRAIS des bts pour un match specifique. Utilise en confirmation
// LIVE pour eviter d'envoyer des cotes de 15+ secondes (source des alertes
// "cotes anciennes envoyees comme fraiches" observees avec YB).
async function fetchFreshBts(matchId) {
  try {
    // YB expose un endpoint par event : GetEvent?id=X&isLive=true
    const j = await evapi(`https://yellowbet.cg/services/evapi/event/GetEvent?id=${matchId}&isLive=true`);
    const ev = j?.data;
    if (ev?.bts && Array.isArray(ev.bts)) return { bts: ev.bts, home: ev.h, away: ev.a };
    // Fallback : re-liste tous les live et cherche l'id
    const list = await evapi('https://yellowbet.cg/services/evapi/event/GetEvents?isLive=true&count=500&take=500');
    const found = (list?.data || []).find((e) => String(e.id) === String(matchId));
    return found ? { bts: found.bts || [], home: found.h, away: found.a } : null;
  } catch { return null; }
}

export default {
  key: 'yellowbet',
  label: 'YellowBet',
  // LIVE DESACTIVE : cotes YB LIVE peu fiables (staleness observee malgre
  // re-fetch, cotes qui ne correspondent pas au site YB au moment de l'envoi).
  // Prematch reste actif. A reactiver quand un endpoint LIVE fiable est trouve.
  supports: { prematch: true, live: false },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    if (!['football', 'basketball', 'tennis', 'volleyball'].includes(sport)) return [];
    if (live) return []; // securite : refuse LIVE meme si supports.live etait vrai
    return live ? listLive(sport) : listPrematch(horizonHours, sport);
  },
  async getOdds(match, { noCache = false } = {}) {
    if (noCache && match.id != null) {
      const fresh = await fetchFreshBts(match.id);
      if (fresh?.bts?.length) {
        return yellowbetFlatOdds(fresh.bts, { home: fresh.home || match.home, away: fresh.away || match.away });
      }
    }
    return yellowbetFlatOdds(match.__raw?.bts || [], { home: match.home, away: match.away });
  },
  async getOddsBatch(matches, { noCache = false } = {}) {
    const out = new Map();
    if (noCache && matches.length) {
      // Optimisation : une seule re-liste live pour tous les matchs (evite
      // N appels HTTP). Puis lookup par id.
      try {
        const list = await evapi('https://yellowbet.cg/services/evapi/event/GetEvents?isLive=true&count=500&take=500');
        const byId = new Map();
        for (const e of list?.data || []) byId.set(String(e.id), e);
        for (const m of matches) {
          const ev = byId.get(String(m.id));
          if (ev?.bts?.length) {
            out.set(m.id, yellowbetFlatOdds(ev.bts, { home: ev.h || m.home, away: ev.a || m.away }));
          } else {
            out.set(m.id, yellowbetFlatOdds(m.__raw?.bts || [], { home: m.home, away: m.away }));
          }
        }
        return out;
      } catch { /* fallback below */ }
    }
    for (const m of matches) {
      out.set(m.id, yellowbetFlatOdds(m.__raw?.bts || [], { home: m.home, away: m.away }));
    }
    return out;
  },
};
