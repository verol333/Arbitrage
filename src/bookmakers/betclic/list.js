// Listing Betclic : tout le programme football pre-match.
//
// PRE-MATCH UNIQUEMENT. Betclic expose bien un indicateur "pari en direct" sur
// chaque match, mais il ne signale PAS que le match est en cours : des matchs
// du lendemain le portent aussi (verifie le 03/09/2026 : 75 matchs marques
// "live" dont des rencontres a J+1). S'en servir produirait de faux surebets
// live. Le direct se distingue donc uniquement par l'heure de coup d'envoi.
import { bcListAll } from './api.js';

export async function listBetclic({ sport = 'football', live = false, horizonHours = 72 } = {}) {
  if (live) return [];
  const now = Date.now();
  const max = now + horizonHours * 3600 * 1000;
  const matches = await bcListAll(sport, { regulation: 'CI' });
  return matches
    .filter((m) => m.id && m.home && m.away && Number.isFinite(m.start) && m.start > now && m.start <= max)
    .map((m) => ({ id: m.id, home: m.home, away: m.away, league: m.league || '', start: m.start }));
}
