// Parseur football Sportcash (XSport scs[] → cotes plates standard).
// Codes cs verifies via audit-sportcash (27/07). Marches DC volontairement
// desactives : cs=15/16/17 sont 3 marches 2-way distincts (pas un 3-way)
// dont le mapping ce→outcome n'est pas fiable → produisait dc_1X=4 alors
// que match_1=1.42, mathematiquement impossible → surebets fantomes.
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
  const putDnb = (m, pfx) => {
    // DRAW NO BET : 2-way pur, ce=1 = home, ce=2 = away.
    for (const e of (m.eqs || [])) {
      if (!okSel(e)) continue;
      if (e.ce === 1) odds[`${pfx}dnb_1`] = price(e);
      else if (e.ce === 2) odds[`${pfx}dnb_2`] = price(e);
    }
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

  for (const m of markets) {
    switch (m.cs) {
      // ─── Full time ─────────────────────────────────────────────────────────
      case 3: put1x2(m, ''); break;                          // FINAL 1X2
      case 8: putHcp(m, ''); break;                          // HANDICAP (h en -100..100)
      case 60016: putHcp(m, ''); break;                      // HANDICAP variante alternate lines
      case 18: putBtts(m, ''); break;                        // BOTH TEAMS TO SCORE
      case 19: putOddEven(m, ''); break;                     // ODD/EVEN
      case 560: putHighestScoringHalf(m); break;             // HIGHEST SCORING HALF (3-way)
      case 60011: putDnb(m, ''); break;                      // DRAW NO BET
      case 1749: putTotal(m, 'tt_home_'); break;             // HOME TOTAL
      case 1750: putTotal(m, 'tt_away_'); break;             // AWAY TOTAL
      case 7989: putTotal(m, 'match_'); break;               // TOTAL GOALS
      // ─── 1st half ──────────────────────────────────────────────────────────
      case 14: put1x2(m, 'ht_'); break;                      // 1ST HALF 1X2
      case 569: putHcp(m, 'ht_'); break;                     // 1ST HALF HANDICAP
      case 60064: putDnb(m, 'ht_'); break;                   // 1ST HALF DRAW NO BET
      // ─── 2nd half ──────────────────────────────────────────────────────────
      case 4009: putHcp(m, 'h2_'); break;                    // 2ND HALF HANDICAP
      // ─── DESACTIVES : DC (cs=15/16/17) ─────────────────────────────────────
      // Bug audit 27/07 : sportcash expose 3 marches DC 2-way distincts, PAS
      // un 3-way. Le mapping ce=1,2,3 → 1X,12,X2 produisait dc_1X=4 alors que
      // match_1=1.42 (impossible). Desactives jusqu'a decodage fiable des eqs.
      case 15: case 16: case 17: break;
      // ─── Ignores : combos exotiques non-comparables 2-way pures ────────────
      case 4:                                                 // HALFTIME/FULLTIME (9-way)
      case 5:                                                 // EXACT GOALS
      case 7:                                                 // CORRECT SCORE
      case 165: case 166: case 550: case 551:                 // team scores (yes/no)
      case 420: case 421: case 422:                           // HOME/AWAY WIN TO 0, 1ST HALF CS
      case 425:                                               // 1X2 & BTTS
      case 563: case 564:                                     // HOME/AWAY ODD/EVEN (par equipe)
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
