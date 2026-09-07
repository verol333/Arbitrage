// Listing Betclic : programme pre-match ET matchs en direct.
//
// DIRECT (verifie le 2026-09-07) : le catalogue continue de lister un match
// apres son coup d'envoi, et ses marches passent en cotes live (Pafos-Olympiakos
// a la 19e : 1,30/4,40/8,50 cote Betclic contre 1,27/4,65/9,00 sur le flux
// in-play Betika — memes matchs, memes ordres de grandeur). Un match en cours se
// reconnait donc a son heure de coup d'envoi passee, JAMAIS a l'indicateur
// "pari en direct" du catalogue : celui-ci est aussi porte par des matchs du
// lendemain (75 releves le 03/09/2026, dont des rencontres a J+1) et produirait
// de faux surebets live.
import { bcListAll } from './api.js';

// Un match disparait du catalogue peu apres son coup de sifflet final ; cette
// fenetre evite malgre tout de retenir une affiche oubliee par le backend.
const LIVE_MAX_AGE_MS = 4 * 3600 * 1000;

export async function listBetclic({ sport = 'football', live = false, horizonHours = 72 } = {}) {
  const now = Date.now();
  const matches = await bcListAll(sport, { regulation: 'CI' });
  const named = matches.filter((m) => m.id && m.home && m.away && Number.isFinite(m.start));
  if (live) {
    return named
      .filter((m) => m.start <= now && now - m.start <= LIVE_MAX_AGE_MS)
      .map((m) => ({ id: m.id, home: m.home, away: m.away, league: m.league || '', start: m.start }));
  }
  const max = now + horizonHours * 3600 * 1000;
  return named
    .filter((m) => m.start > now && m.start <= max)
    .map((m) => ({ id: m.id, home: m.home, away: m.away, league: m.league || '', start: m.start }));
}
