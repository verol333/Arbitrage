// Native SportyBet TT units verified on 14/11/2026: Game = set, Point = point.
// Canonical hcp_* / match_over_* represent POINTS in table tennis; sets have
// their own hcp_sets_* keys. Never reuse the tennis-games market dictionary.
import { isHalfLine } from '../../core/markets.js';
const specNumber = (s, key) => {
  const m = String(s || '').match(new RegExp('(?:^|[|&])' + key + '=(-?\\d+(?:\\.\\d+)?)(?=$|[|&])'));
  return m ? Number(m[1]) : null;
};
export function sportybetTableTennisFlatOdds(markets, put) {
  const odds = { _ids: {} };
  for (const m of markets || []) {
    const id = String(m.id);
    const hcp = specNumber(m.specifier, 'hcp');
    const total = specNumber(m.specifier, 'total');
    const game = specNumber(m.specifier, 'gamenr');
    const pfx = Number.isInteger(game) && game >= 1 && game <= 7 ? 's' + game + '_' : null;
    for (const o of m.outcomes || []) {
      const value = Number(o.odds), oc = String(o.id);
      if (!Number.isFinite(value) || value <= 1) continue;
      if (id === '186' || (id === '245' && pfx)) {
        if (oc === '4' || oc === '5') put(odds, (id === '186' ? '' : pfx) + (oc === '4' ? 'match_1' : 'match_2'), value, m, o);
      } else if (id === '187' || id === '237' || (id === '246' && pfx)) {
        if (hcp == null || !isHalfLine(hcp) || !['1714', '1715'].includes(oc)) continue;
        const prefix = id === '187' ? 'hcp_sets_' : id === '237' ? 'hcp_' : pfx + 'hcp_';
        put(odds, prefix + (oc === '1714' ? 'home_' + hcp : 'away_' + (-hcp)), value, m, o);
      } else if (['238', '19', '20'].includes(id) || (id === '247' && pfx)) {
        if (total == null || !isHalfLine(total) || !['12', '13'].includes(oc)) continue;
        const prefix = id === '238' ? 'match_' : id === '19' ? 'tt_home_' : id === '20' ? 'tt_away_' : pfx;
        put(odds, prefix + (oc === '12' ? 'over_' : 'under_') + total, value, m, o);
      } else if (id === '248' && pfx && ['70', '72'].includes(oc)) {
        put(odds, pfx + (oc === '70' ? 'odd' : 'even'), value, m, o);
      }
    }
  }
  return odds;
}
