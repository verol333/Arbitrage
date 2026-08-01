// BetPawa parser : à partir du JSON /events/{id}, mappe les markets par ID
// stable (comme PremierBet, pour éviter les regex sur noms français ambigus).
//
// Structure : event.markets[].marketType.id + market.row[].prices[]
// Chaque price a name/displayName + odds (float direct).
//
// Market IDs BetPawa (découverts + à compléter via audit) :
//   3743      = 1X2 - FT  (outcomes: 1/X/2)
//   28000810  = 1X2 1UP - FT (paris avec cashout anticipé, mêmes 3 outcomes)
//   28000850  = 1X2 2UP - FT (idem)
//   TODO :   Total buts, BTTS, DC, DNB, Handicap, mi-temps (audit à faire)
import { isHalfLine } from '../../core/markets.js';

export function betpawaFlatOdds(eventJson) {
  const odds = {};
  if (!eventJson?.markets?.length) return odds;

  for (const market of eventJson.markets) {
    const marketId = String(market?.marketType?.id ?? '');
    const prices = flattenPrices(market.row);
    if (!prices.length) continue;

    switch (marketId) {
      // ─── 1X2 fulltime (déterministe) ────────────────────────────────────
      case '3743': {
        // Outcomes attendus : 1, X, 2 (name/displayName)
        const p = pricesByLabel(prices);
        if (p['1']) odds.match_1 = p['1'];
        if (p['X'] || p['x']) odds.match_X = p['X'] || p['x'];
        if (p['2']) odds.match_2 = p['2'];
        break;
      }
      // Variantes 1UP/2UP : mêmes 3 outcomes mais paris avec cashout anticipé
      // (règle différente : le pari est payé si l'équipe prend une avance
      // d'1 ou 2 buts à n'importe quel moment). NON équivalent au 1X2
      // standard — donc IGNORÉS pour éviter les fake arbs.
      case '28000810':
      case '28000850':
        break;

      // ─── Autres market IDs à mapper ici après audit /events/{id} d'un
      // match sample. Pour l'instant on ignore tous les autres pour éviter
      // les faux positifs (leçon PremierBet : regex sur names → fake arbs).
      default:
        break;
    }
  }

  return odds;
}

// Aplati toutes les prices d'un market (row peut contenir plusieurs sous-groupes).
function flattenPrices(row) {
  const out = [];
  if (!Array.isArray(row)) return out;
  for (const r of row) {
    if (!Array.isArray(r?.prices)) continue;
    for (const p of r.prices) out.push(p);
  }
  return out;
}

// Indexe les prices par leur label (name > displayName), valeur = odds.
function pricesByLabel(prices) {
  const map = {};
  for (const p of prices) {
    const label = String(p?.name || p?.displayName || '').trim();
    const val = Number(p?.odds);
    if (label && Number.isFinite(val) && val > 1) map[label] = val;
  }
  return map;
}
