// BetPawa foot : appel Cloudflare Worker (JSON propre avec cotes 1X2).
// Le Worker enveloppe l'auth CF (__cf_bm cookie) et le décodage protobuf.
import { fetchViaWorker, isVirtual, splitTeams } from './api.js';

export async function listMatches({ live = false, horizonHours = 168 } = {}) {
  // Le Worker CF actuel ne prend pas de paramètre live/upcoming — il retourne
  // UPCOMING par défaut. Live à activer plus tard si besoin (nécessite update
  // du worker chez l'utilisateur).
  if (live) {
    console.log('[betpawa] LIVE non supporté par le Worker CF actuel');
    return [];
  }

  const data = await fetchViaWorker();
  if (!data?.matches?.length) {
    console.log(`[betpawa] Worker CF n'a rien renvoyé (success=${data?.success}, err=${data?.error})`);
    return [];
  }

  const out = [];
  const seen = new Set();
  for (const m of data.matches) {
    if (!m?.id || seen.has(m.id)) continue;
    seen.add(m.id);
    // Utilise home/away si présents, sinon splitTeams sur fullName
    let home = m.home, away = m.away;
    if (!home || !away || m.fullName) {
      const teams = splitTeams(m.fullName || `${home} - ${away}`);
      if (teams) { home = teams.home; away = teams.away; }
    }
    if (!home || !away) continue;
    if (isVirtual(`${home} ${away}`)) continue;
    out.push({
      id: String(m.id),
      home, away,
      league: '',
      start: null,
      // odds 1X2 : [home, draw, away] — le parser les convertit en match_1/X/2
      __raw: { odds: Array.isArray(m.odds) ? m.odds : [] },
    });
  }
  console.log(`[betpawa] UPCOMING via Worker CF : ${out.length} matchs foot avec cotes 1X2`);
  return out;
}
