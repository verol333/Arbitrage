// Conversion des marchés TENNIS DE TABLE Betclic (libellés français) vers le
// vocabulaire standard de core/markets.js.
//
// Betclic publie « Vainqueur du match » en DEUX issues : c'est exactement le
// match_1 / match_2 des autres books, donc directement comparable.
//
// Les autres marchés sont volontairement IGNORÉS :
//   - « Écart de points »  : l'écart de Betclic porte sur les POINTS, alors que
//     les autres books mélangent handicap de manches et handicap de points sous
//     les mêmes clés hcp_ : les croiser fabriquerait de faux surebets.
//   - « Nombre total de manches », « Vainqueur de manche » : sans équivalent
//     comparable et non arbitrables.
import { norm, sideOfSel, makePut } from './util.js';

export function betclicTableTennisFlatOdds(markets, { home, away } = {}) {
  const odds = {}; const ids = {}; const put = makePut(odds, ids);
  for (const mk of markets || []) {
    if (!mk || mk.suspended || !Array.isArray(mk.selections) || mk.selections.length !== 2) continue;
    if (norm(mk.name) !== 'vainqueur du match') continue;
    for (const s of mk.selections) {
      const side = sideOfSel(s.name, home, away);
      if (side) put('match_' + (side === 'home' ? '1' : '2'), s, mk);
    }
  }
  if (Object.keys(ids).length) odds._ids = ids;
  return odds;
}
