// Parseur football Sportcash (XSport scs[] → cotes plates standard).
// Codes cs vérifiés via audit-sportcash sur FC Neptunas Klaipeda vs FA Siauliai B
// (156 markets bruts, 77 cs codes distincts).
import { isHalfLine } from '../../core/markets.js';

export function sportcashFlatOdds(markets) {
  const odds = {};
  const price = (e) => Number(e.q) / 100;
  const okSel = (e) => e && e.q != null && Number(e.q) > 100;
  const lineOf = (m) => Number(m.h != null ? m.h : m.hs) / 100;

  const put1x2 = (m, pfx) => {
    for (const e of (m.eqs || [])) {
      if (!okSel(e)) continue;
      if (e.ce === 1) odds[`${pfx}match_1`] = price(e);
      else if (e.ce === 2) odds[`${pfx}match_X`] = price(e);
      else if (e.ce === 3) odds[`${pfx}match_2`] = price(e);
    }
  };
  const putDC = (m, pfx) => {
    // Sportcash sépare DC en 2 marchés distincts (cs=16 et cs=17), chacun 2-way :
    // cs=16 typiquement 1X vs 12  |  cs=17 typiquement 1X vs X2 (à confirmer via `d`)
    // On mappe par le label du marché s'il est présent, sinon par convention.
    const d = String(m.d || '').toUpperCase();
    for (const e of (m.eqs || [])) {
      if (!okSel(e)) continue;
      // Heuristique : les valeurs standard de DC sont ce=1 (1X) / ce=2 (12) / ce=3 (X2)
      if (e.ce === 1) odds[`${pfx}dc_1X`] = price(e);
      else if (e.ce === 2) odds[`${pfx}dc_12`] = price(e);
      else if (e.ce === 3) odds[`${pfx}dc_X2`] = price(e);
    }
    // Certaines déclinaisons de DC ne mettent que 2 outcomes ; ne pas paniquer.
  };
  const putTotal = (m, pfx) => {
    const line = lineOf(m);
    if (!isHalfLine(line)) return;
    for (const e of (m.eqs || [])) {
      if (!okSel(e)) continue;
      // Vérifié via audit : ce=1 = Under, ce=2 = Over
      if (e.ce === 1) odds[`${pfx}under_${line}`] = price(e);
      else if (e.ce === 2) odds[`${pfx}over_${line}`] = price(e);
    }
  };
  const putBtts = (m, pfx) => {
    for (const e of (m.eqs || [])) {
      if (!okSel(e)) continue;
      if (e.ce === 1) odds[`${pfx}btts_yes`] = price(e);
      else if (e.ce === 2) odds[`${pfx}btts_no`] = price(e);
    }
  };
  const putHcp = (m, pfx) => {
    const line = lineOf(m);
    if (!isHalfLine(line)) return;
    for (const e of (m.eqs || [])) {
      if (!okSel(e)) continue;
      if (e.ce === 1) odds[`${pfx}hcp_home_${line}`] = price(e);
      else if (e.ce === 2) odds[`${pfx}hcp_away_${-line}`] = price(e);
    }
  };
  const putOddEven = (m, pfx) => {
    for (const e of (m.eqs || [])) {
      if (!okSel(e)) continue;
      if (e.ce === 1) odds[`${pfx}odd`] = price(e);
      else if (e.ce === 2) odds[`${pfx}even`] = price(e);
    }
  };
  const putHighestScoringHalf = (m) => {
    // cs=560 : HIGHEST SCORING HALF (1MT / 2MT / égalité)
    for (const e of (m.eqs || [])) {
      if (!okSel(e)) continue;
      if (e.ce === 1) odds.half_most_ht = price(e);
      else if (e.ce === 2) odds.half_most_h2 = price(e);
      else if (e.ce === 3) odds.half_most_equal = price(e);
    }
  };

  // Double Chance cs=15 = 2-way {1X, X2} chez XSport Sportcash.
  // Audit sample : [{"ce":1,"q":110},{"ce":2,"q":540}] = 1.10 et 5.40.
  // Sanity : si ce=1=1X (~91%) alors ce=2 doit etre X2 (~18%), pas 12 (~85%).
  // Le "12" n'existe pas en cs=15 (probablement dispatche en cs=17 ou cs=690).
  // Verifie via Galatasaray-Venezia : SC dc_X2=4.60 vs autres dc_12=1.10 -> le
  // faux profit 57% prouvait le mismapping. Corrige : ce=2 = X2 (pas 12).
  const putDcReal = (m) => {
    for (const e of (m.eqs || [])) {
      if (!okSel(e)) continue;
      if (e.ce === 1) odds.dc_1X = price(e);
      else if (e.ce === 2) odds.dc_X2 = price(e);
    }
  };

  const putDnb = (m, pfx) => {
    for (const e of (m.eqs || [])) {
      if (!okSel(e)) continue;
      if (e.ce === 1) odds[`${pfx}dnb_1`] = price(e);
      else if (e.ce === 2) odds[`${pfx}dnb_2`] = price(e);
    }
  };

  for (const m of markets) {
    switch (m.cs) {
      // ─── Full time (codes vérifiés via audit prématch) ─────────────────────
      case 3: put1x2(m, ''); break;                          // FINAL 1X2
      // cs=15 DÉSACTIVÉ : le champ `d` (label outcome) est vide dans l'API,
      // donc on ne peut PAS savoir de manière fiable si ce=1=dc_1X ou dc_X2.
      // L'audit prouve que le mapping est correct pour certains matchs mais
      // inversé pour d'autres (ex: Montrose vs Hamilton Academical → arb fake
      // 19.5% généré par mismatch dc_X2=2.00 vs vrai dc_1X=2.00). Les 1X2
      // comparators dérivent déjà DC de cs=3 — on n'a pas besoin de cs=15.
      case 15: break;
      case 18: putBtts(m, ''); break;                        // BOTH TEAMS TO SCORE
      case 19: putOddEven(m, ''); break;                     // ODD/EVEN
      case 560: putHighestScoringHalf(m); break;             // HIGHEST SCORING HALF (3-way)
      case 1749: putTotal(m, 'tt_home_'); break;             // HOME TOTAL
      case 1750: putTotal(m, 'tt_away_'); break;             // AWAY TOTAL
      case 7989: putTotal(m, 'match_'); break;               // TOTAL GOALS
      case 60011: putDnb(m, ''); break;                      // DRAW NO BET (nouveau, découvert via audit)
      case 60016: putHcp(m, ''); break;                      // ASIAN HANDICAP 2-way (half lines uniquement)
      // ─── 1st half ──────────────────────────────────────────────────────────
      case 14: put1x2(m, 'ht_'); break;                      // 1ST HALF (1X2)
      case 569: putHcp(m, 'ht_'); break;                     // 1ST HALF HANDICAP
      case 60064: putDnb(m, 'ht_'); break;                   // 1ST HALF DRAW NO BET (nouveau)
      // ─── 2nd half ──────────────────────────────────────────────────────────
      case 127: put1x2(m, 'h2_'); break;                     // 2ND HALF 1X2
      case 10003: putOddEven(m, 'h2_'); break;               // 2ND HALF ODD/EVEN (nouveau)
      // ─── Corners ──────────────────────────────────────────────────────────
      case 186:                                              // TOTALE CALCI ANGOLO (italien)
      case 975: putTotal(m, 'cor_'); break;                  // TOTAL CORNERS
      case 9211: putTotal(m, 'cor_ht_'); break;              // 1ST HALF TOTAL CORNERS
      case 3237: putOddEven(m, 'cor_'); break;               // ODD/EVEN CORNERS
      // ─── Ignorés : cs=8 & cs=4009 sont 3-way European handicaps (ce=1/2/3)
      // avec lignes entières (h∈[-4,-3,-2,-1,1]). Non comparables à Asian
      // 2-way ; les mapper vers hcp_home/away donnait des mismatches.
      // Le vrai Asian half-line est cs=60016 (fulltime) — pas d'équivalent 2H connu.
      case 8:                                                 // HANDICAP 3-way European
      case 4009:                                              // 2ND HALF HANDICAP 3-way European
      // ─── Ignorés (combos exotiques non-comparables 2-way pures) ────────────
      case 16: case 17:                                       // DC combos anciennement mal mappes
      case 4:                                                 // HALFTIME/FULLTIME (9-way)
      case 5:                                                 // EXACT GOALS
      case 7:                                                 // CORRECT SCORE
      case 165: case 166: case 550: case 551:                 // team scores (yes/no)
      case 420: case 421: case 422:                           // HOME/AWAY WIN TO 0, 1ST HALF CS
      case 425:                                               // 1X2 & BTTS
      case 563: case 564:                                     // HOME/AWAY ODD/EVEN (par équipe, pas comparable direct)
      case 570: case 571:                                     // HOME/AWAY EXACT GOALS
      case 688: case 689: case 690:                           // 1X/12/X2 & GG
      case 838:                                               // WHICH TEAM TO SCORE
      case 7328: case 7329: case 7330:                        // 1/X/2 OR GG
      case 7331: case 7332: case 7333:                        // 1/X/2 OR NG
      case 7446:                                              // WINNING MARGIN
        break;
      default: break;
    }
  }
  return odds;
}
