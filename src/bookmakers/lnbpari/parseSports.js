// Conversion des marches LNB Pari pour les sports AUTRES que le football.
//
// Le flux utilise le MEME catalogue de types de marche pour tous les sports :
//   T1  vainqueur 2 issues (0 = dom./J1, 3 = ext./J2)
//   T2  3 issues            (0 = dom., 1 = nul, 3 = ext.)
//   T3  double chance       (8 = 1X, 9 = X2, 10 = 12)
//   T4  handicap            (86 = dom., 87 = ext. ; ligne = celle du domicile)
//   T5  total               (4 = plus de, 5 = moins de)
//   T6  pair / impair       (6 = pair, 7 = impair)
//   T7  total individuel    (parametres [numero d'equipe, ligne] ; 37 / 38)
//   T260 handicap par sets  (tennis, tennis de table, volley)
// resultKind 1 = l'unite de score du sport : points (basket, tennis de table,
// volley), jeux (tennis), buts (hockey). Tout autre resultKind est ignore.
//
// Ce qui est retenu par sport, pour coller EXACTEMENT au comparateur du moteur :
//   basket  : vainqueur = T145 "y compris prolongation" (le comparateur basket
//             est 2 issues) ; quarts Q1-Q4 en 3 issues via T2.
//   hockey  : vainqueur = T2 "temps reglementaire" 3 issues + double chance ;
//             pas de periode (le comparateur hockey n'en compare aucune).
//   tennis / tennis de table / volley : vainqueur 2 issues T1, et les SETS
//             (periodes 1 a 5) sous les prefixes s1_ a s5_.
//
// Regles de surete identiques au football : demi-lignes uniquement, cotes gelees
// ignorees, marches de segment (subPeriod) ecartes.
import { isHalfLine } from '../../core/markets.js';

const RESULT_KIND_MAIN = 1;
const fmt = (n) => String(Number(n));

// Prefixe de periode attendu par le moteur, par sport.
const PERIOD_PREFIX = {
  basket: { 1: 'q1_', 2: 'q2_', 3: 'q3_', 4: 'q4_' },
  tennis: { 1: 's1_', 2: 's2_', 3: 's3_', 4: 's4_', 5: 's5_' },
  table_tennis: { 1: 's1_', 2: 's2_', 3: 's3_', 4: 's4_', 5: 's5_' },
  volleyball: { 1: 's1_', 2: 's2_', 3: 's3_', 4: 's4_', 5: 's5_' },
  hockey: {},
};

export function lnbpariSportOdds(markets = [], sport = 'basket') {
  const periods = PERIOD_PREFIX[sport];
  if (!periods) return {};
  const odds = {};
  const put = (key, value) => {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 1) return;
    if (odds[key] == null || v > odds[key]) odds[key] = v;
  };

  for (const m of markets) {
    const k = m && m.key;
    if (!k || k.resultKind !== RESULT_KIND_MAIN) continue;
    // Marche de segment ("jusqu'a la Xe minute") : meme cle que le marche
    // complet, cotes differentes — source de faux surebets. Ecarte.
    if (k.subPeriod != null) continue;
    const period = Number(k.period) || 0;
    const pfx = period === 0 ? '' : periods[period];
    if (pfx == null) continue; // periode non modelisee (prolongation, mi-temps...)
    const type = k.marketType;

    for (const item of ((m.value && m.value.marketItems) || [])) {
      if (item.isRemoved) continue;
      const par = (item.key && item.key.marketParameters) || [];
      const by = {};
      for (const o of (item.outcomes || [])) {
        if (o.isRemoved || o.isFrozen) continue;
        by[o.key.type] = o.odd / 100;
      }

      // ─── Vainqueur ───────────────────────────────────────────────────────
      if (pfx === '') {
        if (sport === 'basket' && type === 145) {
          put('match_1', by[0]); put('match_2', by[3]);
        } else if (sport === 'hockey' && type === 2) {
          put('match_1', by[0]); put('match_X', by[1]); put('match_2', by[3]);
        } else if (sport === 'hockey' && type === 3) {
          put('dc_1X', by[8]); put('dc_X2', by[9]); put('dc_12', by[10]);
        } else if (sport !== 'basket' && sport !== 'hockey' && type === 1) {
          put('match_1', by[0]); put('match_2', by[3]);
        }
      } else if (sport === 'basket' && type === 2) {
        // Un quart peut finir a egalite : le nul est une issue reelle.
        put(pfx + 'match_1', by[0]); put(pfx + 'match_X', by[1]); put(pfx + 'match_2', by[3]);
      } else if (type === 1) {
        put(pfx + 'match_1', by[0]); put(pfx + 'match_2', by[3]);
      }

      // ─── Totaux, handicaps, pair/impair, totaux individuels ──────────────
      if (type === 5) {
        const L = par[0];
        if (!isHalfLine(L)) continue;
        put(pfx ? pfx + 'over_' + fmt(L) : 'match_over_' + fmt(L), by[4]);
        put(pfx ? pfx + 'under_' + fmt(L) : 'match_under_' + fmt(L), by[5]);
      } else if (type === 4) {
        const L = Number(par[0]);
        if (!isHalfLine(L)) continue;
        put(pfx + 'hcp_home_' + fmt(L), by[86]);
        put(pfx + 'hcp_away_' + fmt(-L), by[87]);
      } else if (type === 6) {
        put(pfx + 'even', by[6]); put(pfx + 'odd', by[7]);
      } else if (type === 7 && pfx === '') {
        const side = String(par[0]) === '1' ? 'home' : 'away';
        const L = par[1];
        if (!isHalfLine(L)) continue;
        put('tt_' + side + '_over_' + fmt(L), by[37]);
        put('tt_' + side + '_under_' + fmt(L), by[38]);
      } else if (type === 260 && pfx === '' && sport !== 'basket' && sport !== 'hockey') {
        // Handicap par SETS (et non par points/jeux).
        const L = Number(par[0]);
        if (!isHalfLine(L)) continue;
        put('hcp_sets_home_' + fmt(L), by[86]);
        put('hcp_sets_away_' + fmt(-L), by[87]);
      }
    }
  }
  return odds;
}
