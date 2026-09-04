// Conversion des marchés VOLLEYBALL Betclic (libellés français) vers le
// vocabulaire standard de core/markets.js.
//
// Marchés lus (les seuls comparables) :
//   "Vainqueur du match"       -> match_1 / match_2 (2-way, noms d'équipes)
//   "Nombre total de points"   -> match_over_<L> / match_under_<L> (demi-lignes)
// Ignorés : "Écart de points" (bandes d'écart), "Score Final Sets", "Nombre
// total de sets", marchés par set, points par joueuse. Demi-lignes seulement.
import { norm, numFR, halfLine, sideOfSel, makePut } from './util.js';

export function betclicVolleyballFlatOdds(markets, { home, away } = {}) {
  const odds = {}; const ids = {}; const put = makePut(odds, ids);
  for (const mk of markets || []) {
    if (!mk || mk.suspended || !Array.isArray(mk.selections) || mk.selections.length < 2) continue;
    const name = norm(mk.name);

    if (name === 'vainqueur du match') {
      for (const s of mk.selections) {
        const side = sideOfSel(s.name, home, away);
        if (side) put('match_' + (side === 'home' ? '1' : '2'), s, mk);
      }
      continue;
    }
    if (name === 'nombre total de points') {
      for (const s of mk.selections) {
        const l = norm(s.name);
        const over = l.startsWith('+'), under = l.startsWith('-');
        if (!over && !under) continue;
        const L = halfLine(numFR(l));
        if (!L) continue;
        put((over ? 'match_over_' : 'match_under_') + L, s, mk);
      }
    }
  }
  if (Object.keys(ids).length) odds._ids = ids;
  return odds;
}
