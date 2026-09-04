// Conversion des marchés BASKET Betclic (libellés français) vers le vocabulaire
// standard de core/markets.js.
//
// Marchés lus (les seuls comparables) :
//   "Vainqueur du match"              -> match_1 / match_2 (2-way, noms d'équipes)
//   "Nombre total de points"          -> match_over_<L> / match_under_<L> (demi-lignes)
//   "Nombre total de points - {team}" -> tt_home_over/under ou tt_away_over/under
// Ignorés : "Écart de points" (bandes d'écart, pas un handicap asiatique),
// quart-temps, scores exacts, joueurs. Demi-lignes seulement.
import { norm, numFR, halfLine, sideOfSel, sideIn, makePut } from './util.js';

export function betclicBasketFlatOdds(markets, { home, away } = {}) {
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
    // Total du match (exact) — avant le total par équipe (startsWith).
    if (name === 'nombre total de points') {
      for (const s of mk.selections) {
        const l = norm(s.name);
        const over = l.startsWith('+'), under = l.startsWith('-');
        if (!over && !under) continue;
        const L = halfLine(numFR(l));
        if (!L) continue;
        put((over ? 'match_over_' : 'match_under_') + L, s, mk);
      }
      continue;
    }
    // Total par équipe : "Nombre total de points - Espagne F."
    if (name.startsWith('nombre total de points')) {
      const side = sideIn(name, home, away);
      if (!side) continue;
      for (const s of mk.selections) {
        const l = norm(s.name);
        const over = l.startsWith('+'), under = l.startsWith('-');
        if (!over && !under) continue;
        const L = halfLine(numFR(l));
        if (!L) continue;
        put('tt_' + side + '_' + (over ? 'over_' : 'under_') + L, s, mk);
      }
    }
  }
  if (Object.keys(ids).length) odds._ids = ids;
  return odds;
}
