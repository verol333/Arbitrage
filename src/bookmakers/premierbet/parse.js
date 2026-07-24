// Parseur football PremierBet (Editec eventGames → cotes plates standard).
// Port fidèle de shared/premierbetParse.ts.
import { isHalfLine } from '../../core/markets.js';

export function premierbetFlatOdds(games) {
  const odds = {};
  const byPos = (g) => {
    const m = {};
    for (const o of (g.outcomes || [])) {
      const c = Number(o.outcomeOdds);
      if (o.status === 100 && Number.isFinite(c) && c > 1) m[o.outcomePosition] = c;
    }
    return m;
  };
  const put1x2 = (g, pfx) => { const p = byPos(g); if (p[0]) odds[`${pfx}match_1`] = p[0]; if (p[1]) odds[`${pfx}match_X`] = p[1]; if (p[2]) odds[`${pfx}match_2`] = p[2]; };
  const putDC = (g, pfx) => { const p = byPos(g); if (p[0]) odds[`${pfx}dc_1X`] = p[0]; if (p[1]) odds[`${pfx}dc_12`] = p[1]; if (p[2]) odds[`${pfx}dc_X2`] = p[2]; };
  const putBtts = (g, pfx) => { const p = byPos(g); if (p[0]) odds[`${pfx}btts_yes`] = p[0]; if (p[1]) odds[`${pfx}btts_no`] = p[1]; };
  const putTotal = (g, pfx) => {
    const line = Number(g.argument);
    if (!isHalfLine(line)) return;
    const p = byPos(g);
    if (p[0]) odds[`${pfx}under_${line}`] = p[0];
    if (p[1]) odds[`${pfx}over_${line}`] = p[1];
  };
  const putDnb = (g, pfx) => { const p = byPos(g); if (p[0]) odds[`${pfx}dnb_1`] = p[0]; if (p[1]) odds[`${pfx}dnb_2`] = p[1]; };
  const putAsianHcp = (g) => {
    const line = Number(g.argument);
    if (!isHalfLine(line)) return;
    const p = byPos(g);
    if (p[0]) odds[`hcp_home_${line}`] = p[0];
    if (p[1]) odds[`hcp_away_${-line}`] = p[1];
  };

  const putOddEven = (g, pfx) => { const p = byPos(g); if (p[0]) odds[`${pfx}odd`] = p[0]; if (p[1]) odds[`${pfx}even`] = p[1]; };
  const putTeamTotal = (g, side, pfx) => {
    const line = Number(g.argument);
    if (!isHalfLine(line)) return;
    const p = byPos(g);
    if (p[0]) odds[`${pfx}tt_${side}_under_${line}`] = p[0];
    if (p[1]) odds[`${pfx}tt_${side}_over_${line}`] = p[1];
  };
  const putHtHcp = (g, pfx) => {
    const line = Number(g.argument);
    if (!isHalfLine(line)) return;
    const p = byPos(g);
    if (p[0]) odds[`${pfx}hcp_home_${line}`] = p[0];
    if (p[1]) odds[`${pfx}hcp_away_${-line}`] = p[1];
  };

  for (const g of games) {
    switch (Number(g.gameType)) {
      case 1: put1x2(g, ''); break;
      case 4: putDC(g, ''); break;
      case 98: putBtts(g, ''); break;
      case 8: putTotal(g, 'match_'); break;
      case -458: putAsianHcp(g); break;
      case 93: putDnb(g, ''); break;
      case 18: putOddEven(g, ''); break;
      case -459: putTeamTotal(g, 'home', ''); break;
      case -460: putTeamTotal(g, 'away', ''); break;
      // 1st half
      case 3: put1x2(g, 'ht_'); break;
      case 27: putDC(g, 'ht_'); break;
      case 120: putBtts(g, 'ht_'); break;
      case -284: putTotal(g, 'ht_'); break;
      case -237: putDnb(g, 'ht_'); break;
      case -461: putHtHcp(g, 'ht_'); break;
      case -285: putOddEven(g, 'ht_'); break;
      case -462: putTeamTotal(g, 'home', 'ht_'); break;
      case -463: putTeamTotal(g, 'away', 'ht_'); break;
      // 2nd half
      case 111: put1x2(g, 'h2_'); break;
      case -188: putDC(g, 'h2_'); break;
      case 121: putBtts(g, 'h2_'); break;
      case -286: putTotal(g, 'h2_'); break;
      case -283: putDnb(g, 'h2_'); break;
      case -464: putHtHcp(g, 'h2_'); break;
      case -287: putOddEven(g, 'h2_'); break;
      case -465: putTeamTotal(g, 'home', 'h2_'); break;
      case -466: putTeamTotal(g, 'away', 'h2_'); break;
      // Corners
      case -232: putTotal(g, 'cor_'); break;
      case -233: putHtHcp(g, 'cor_'); break;
      case -234: putOddEven(g, 'cor_'); break;
      case -467: putTotal(g, 'cor_ht_'); break;
      default: break;
    }
  }
  return odds;
}
