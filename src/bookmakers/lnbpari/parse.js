// Conversion des marches LNB Pari (direct-feed) vers le vocabulaire standard.
//
// Cle d'un marche : { eventId, resultKind, marketType, period }.
//   resultKind = ce qui est compte. VERIFIE via le dictionnaire officiel
//     (/api/Localization/v2/markets) : la condition "=F:=1:..." correspond aux
//     BUTS. Tout autre resultKind (corners, cartons, tirs, penalties...) est
//     IGNORE : leurs libelles ne sont pas traduits pour le foot, donc pas
//     d'identification certaine, donc pas de pari.
//   period : 0 = temps plein, 1 = 1re mi-temps, 2 = 2e mi-temps (verifie via
//     dictionnaire periods.F). Les prolongations/penalties (3,4,5,6) sont exclues.
//
// Deux regles de surete, identiques aux autres books :
//   1) WHITELIST de types de marche (les 900 autres types sont ignores) ;
//   2) DEMI-LIGNES uniquement : les lignes quart (0.25/0.75, remboursement
//      partiel) et entieres (mise remboursee) ne donnent pas d'arbitrage garanti.
//
// Les cotes arrivent en CENTIEMES : odd 125 = 1.25.
import { isHalfLine } from '../../core/markets.js';

const PERIOD_PREFIX = { 0: '', 1: 'ht_', 2: 'h2_' };
const RESULT_KIND_GOALS = 1;

const fmt = (n) => String(Number(n));

export function lnbpariFlatOdds(markets = []) {
  const odds = {};
  const put = (key, value) => {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 1) return;
    if (odds[key] == null || v > odds[key]) odds[key] = v;
  };

  for (const m of markets) {
    const k = m && m.key;
    if (!k || k.resultKind !== RESULT_KIND_GOALS) continue;
    const p = PERIOD_PREFIX[k.period];
    if (p == null) continue;
    const type = k.marketType;

    for (const item of ((m.value && m.value.marketItems) || [])) {
      if (item.isRemoved) continue;
      const par = (item.key && item.key.marketParameters) || [];
      // Cotes par code d'issue : jamais par libelle (traduit, donc instable).
      const by = {};
      for (const o of (item.outcomes || [])) {
        if (o.isRemoved || o.isFrozen) continue;
        by[o.key.type] = o.odd / 100;
      }

      if (type === 2) {
        // 1X2 (0 = Win 1, 1 = Draw, 3 = Win 2)
        put(p + 'match_1', by[0]); put(p + 'match_X', by[1]); put(p + 'match_2', by[3]);
      } else if (type === 3) {
        // Double chance (8 = 1X, 9 = X2, 10 = 12 / "No draw")
        put(p + 'dc_1X', by[8]); put(p + 'dc_X2', by[9]); put(p + 'dc_12', by[10]);
      } else if (type === 5) {
        // Total buts (4 = Over, 5 = Under)
        const L = par[0];
        if (!isHalfLine(L)) continue;
        put(p ? p + 'over_' + fmt(L) : 'match_over_' + fmt(L), by[4]);
        put(p ? p + 'under_' + fmt(L) : 'match_under_' + fmt(L), by[5]);
      } else if (type === 4) {
        // Handicap : la ligne du parametre est celle du DOMICILE (86), l'exterieur
        // (87) joue la ligne opposee. Meme convention que les autres books.
        const L = Number(par[0]);
        if (!isHalfLine(L)) continue;
        put(p + 'hcp_home_' + fmt(L), by[86]);
        put(p + 'hcp_away_' + fmt(-L), by[87]);
      } else if (type === 6 && !p) {
        // Pair / impair (6 = Even, 7 = Odd) — temps plein uniquement.
        put('even', by[6]); put('odd', by[7]);
      } else if (type === 28) {
        // Les deux equipes marquent (14 = Oui, 15 = Non)
        put(p + 'btts_yes', by[14]); put(p + 'btts_no', by[15]);
      } else if (type === 7) {
        // Total individuel : parametres [numero d'equipe, ligne] (37 Over / 38 Under)
        const side = String(par[0]) === '1' ? 'home' : 'away';
        const L = par[1];
        if (!isHalfLine(L)) continue;
        put(p + 'tt_' + side + '_over_' + fmt(L), by[37]);
        put(p + 'tt_' + side + '_under_' + fmt(L), by[38]);
      }
    }
  }
  return odds;
}
