// Conversion des marchés TENNIS Betclic (libellés français) vers le vocabulaire
// standard de core/markets.js.
//
// Betclic tennis expose une trentaine de marchés par match ; on n'en lit que deux,
// les seuls comparables avec les autres books :
//   "Vainqueur du match"        -> match_1 / match_2 (2-way, noms des joueurs)
//   "Nombre total de jeux"      -> match_over_<L> / match_under_<L> (demi-lignes)
//   "Écart de sets"             -> hcp_sets_home_<L> / hcp_sets_away_<L>
//   "{joueur} gagne au moins 1 set" -> tt_<side>_wins_a_set_yes / _no
// Les marchés de set (vainqueur du set, score exact des sets),
// de jeu (vainqueur du jeu N) et combinés sont ignorés : non comparables.
import { norm, numFR, halfLine, sideOfSel, sideIn, makePut, putEcart } from './util.js';

export function betclicTennisFlatOdds(markets, { home, away } = {}) {
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
    // Handicap sets, publié en phrases sous "Écart de sets".
    if (name.startsWith('ecart de sets')) { putEcart(mk, home, away, 'hcp_sets_', put); continue; }
    // "{joueur} gagne au moins 1 set" : Oui / Non (2 issues complémentaires).
    if (name.endsWith('gagne au moins 1 set')) {
      const side = sideIn(name, home, away);
      if (!side) continue;
      for (const s of mk.selections) {
        const l = norm(s.name);
        if (l === 'oui') put('tt_' + side + '_wins_a_set_yes', s, mk);
        else if (l === 'non') put('tt_' + side + '_wins_a_set_no', s, mk);
      }
      continue;
    }
    if (name === 'nombre total de jeux') {
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
