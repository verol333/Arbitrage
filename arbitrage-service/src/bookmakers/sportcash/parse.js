// Parseur football Sportcash (XSport scs[] → cotes plates standard).
// Port fidèle de shared/sportcashParse.ts.
import { isHalfLine } from '../../core/markets.js';

export function sportcashFlatOdds(markets) {
  const odds = {};
  const price = (e) => Number(e.q) / 100;
  const okSel = (e) => e && e.q != null && Number(e.q) > 100;

  const put1x2 = (m, pfx) => {
    for (const e of (m.eqs || [])) {
      if (!okSel(e)) continue;
      if (e.ce === 1) odds[`${pfx}match_1`] = price(e);
      else if (e.ce === 2) odds[`${pfx}match_X`] = price(e);
      else if (e.ce === 3) odds[`${pfx}match_2`] = price(e);
    }
  };
  const putTotal = (m, pfx) => {
    const line = Number(m.h != null ? m.h : m.hs) / 100;
    if (!isHalfLine(line)) return;
    for (const e of (m.eqs || [])) {
      if (!okSel(e)) continue;
      if (e.ce === 1) odds[`${pfx}under_${line}`] = price(e);
      else if (e.ce === 2) odds[`${pfx}over_${line}`] = price(e);
    }
  };

  for (const m of markets) {
    switch (m.cs) {
      case 3: put1x2(m, ''); break;
      case 14: put1x2(m, 'ht_'); break;
      case 127: put1x2(m, 'h2_'); break;
      case 7989: putTotal(m, 'match_'); break;
      default: break;
    }
  }
  return odds;
}
