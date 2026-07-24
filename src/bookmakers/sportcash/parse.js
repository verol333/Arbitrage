// Parseur football Sportcash (XSport scs[] → cotes plates standard).
// Expanded: covers all exploitable market codes from XSport API.
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
  const putDC = (m, pfx) => {
    for (const e of (m.eqs || [])) {
      if (!okSel(e)) continue;
      if (e.ce === 1) odds[`${pfx}dc_1X`] = price(e);
      else if (e.ce === 2) odds[`${pfx}dc_12`] = price(e);
      else if (e.ce === 3) odds[`${pfx}dc_X2`] = price(e);
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
  const putBtts = (m, pfx) => {
    for (const e of (m.eqs || [])) {
      if (!okSel(e)) continue;
      if (e.ce === 1) odds[`${pfx}btts_yes`] = price(e);
      else if (e.ce === 2) odds[`${pfx}btts_no`] = price(e);
    }
  };
  const putDnb = (m, pfx) => {
    for (const e of (m.eqs || [])) {
      if (!okSel(e)) continue;
      if (e.ce === 1) odds[`${pfx}dnb_1`] = price(e);
      else if (e.ce === 2) odds[`${pfx}dnb_2`] = price(e);
    }
  };
  const putHcp = (m, pfx) => {
    const line = Number(m.h != null ? m.h : m.hs) / 100;
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

  for (const m of markets) {
    switch (m.cs) {
      // Full time
      case 3: put1x2(m, ''); break;
      case 7989: putTotal(m, 'match_'); break;
      case 28: putDC(m, ''); break;
      case 59: putBtts(m, ''); break;
      case 7990: putHcp(m, ''); break;
      case 60: putDnb(m, ''); break;
      case 6188: putOddEven(m, ''); break;
      // Individual totals (home=ce1/2, away=ce1/2 on separate market)
      case 7991: putTotal(m, 'tt_home_'); break;
      case 7992: putTotal(m, 'tt_away_'); break;
      // 1st half
      case 14: put1x2(m, 'ht_'); break;
      case 7993: putTotal(m, 'ht_'); break;
      case 34: putDC(m, 'ht_'); break;
      case 122: putBtts(m, 'ht_'); break;
      case 7994: putHcp(m, 'ht_'); break;
      case 123: putDnb(m, 'ht_'); break;
      case 6189: putOddEven(m, 'ht_'); break;
      // 2nd half
      case 127: put1x2(m, 'h2_'); break;
      case 7995: putTotal(m, 'h2_'); break;
      case 128: putDC(m, 'h2_'); break;
      case 129: putBtts(m, 'h2_'); break;
      case 7996: putHcp(m, 'h2_'); break;
      case 130: putDnb(m, 'h2_'); break;
      case 6190: putOddEven(m, 'h2_'); break;
      // Corners
      case 7997: putTotal(m, 'cor_'); break;
      case 7998: putHcp(m, 'cor_'); break;
      case 6191: putOddEven(m, 'cor_'); break;
      case 7999: putTotal(m, 'cor_ht_'); break;
      default: break;
    }
  }
  return odds;
}
