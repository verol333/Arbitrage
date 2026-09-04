// Conversion des marchés HOCKEIE (glace) Betclic (libellés français) vers le
// vocabulaire standard de core/markets.js.
//
// Marchés lus (régular time uniquement, les seuls comparables) :
//   "Résultat du match (tps rég.)"        -> match_1 / match_X / match_2 (3-way)
//   "Double chance"                       -> dc_1X / dc_12 / dc_X2
//   "Nombre total de buts (tps rég.)"     -> match_over_<L> / match_under_<L>
// Ignorés : "Vainqueur du match" (2-way OT, souvent incomplet), "Double Chance
// Buteur", "Quelle équipe va marquer le but N", totaux OT-inclus, buteurs.
// Demi-lignes seulement (isHalfLine) — aucune ligne entière (remboursement).
import { norm, numFR, halfLine, sideOfSel, makePut } from './util.js';

export function betclicHockeyFlatOdds(markets, { home, away } = {}) {
  const odds = {}; const ids = {}; const put = makePut(odds, ids);
  for (const mk of markets || []) {
    if (!mk || mk.suspended || !Array.isArray(mk.selections) || mk.selections.length < 2) continue;
    const name = norm(mk.name);

    // Résultat du match (tps rég.) — 3-way 1X2
    if (name === 'resultat du match (tps reg.)' || name === 'resultat du match (tps reg)') {
      for (const s of mk.selections) {
        const l = norm(s.name);
        if (l === 'nul' || l === 'match nul') put('match_X', s, mk);
        else { const side = sideOfSel(s.name, home, away); if (side) put('match_' + (side === 'home' ? '1' : '2'), s, mk); }
      }
      continue;
    }
    // Double chance : "A ou Nul" / "A ou B" / "Nul ou B"
    if (name === 'double chance') {
      for (const s of mk.selections) {
        const parts = norm(s.name).split(' ou ').map((p) => p.trim());
        if (parts.length !== 2) continue;
        const codes = parts.map((p) => {
          if (p === 'nul' || p === 'match nul') return 'X';
          if (norm(home) && p.startsWith(norm(home))) return '1';
          if (norm(away) && p.startsWith(norm(away))) return '2';
          return null;
        });
        if (codes.includes(null)) continue;
        const has = (c) => codes.includes(c);
        const key = has('1') && has('X') ? 'dc_1X' : has('1') && has('2') ? 'dc_12' : has('X') && has('2') ? 'dc_X2' : null;
        if (key) put(key, s, mk);
      }
      continue;
    }
    // Nombre total de buts (tps rég.) — régular time only
    if (name === 'nombre total de buts (tps reg.)' || name === 'nombre total de buts (tps reg)') {
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
