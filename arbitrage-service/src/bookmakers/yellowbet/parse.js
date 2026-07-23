// Parseur YellowBet evapi bts[] → cotes plates standard.
// Port fidèle de shared/yellowbetEvapiParse.ts.
import { isHalfLine } from '../../core/markets.js';

const priceOf = (o) => { const p = parseFloat(o?.p); return isNaN(p) || p <= 1 ? null : p; };
const lbl = (o) => String(o?.n ?? o?.id ?? '').trim().toLowerCase();
const lineOf = (o) => { const l = parseFloat(o?.l ?? o?.sp ?? o?.hc); return isNaN(l) ? NaN : l; };
const findMarket = (bts, name) => {
  const target = name.toLowerCase();
  return bts.find((m) => String(m?.n || '').trim().toLowerCase() === target) || null;
};

export function yellowbetFlatOdds(bts) {
  const odds = {};
  if (!Array.isArray(bts)) return odds;
  const set = (k, c) => { if (c && (!odds[k] || c > odds[k])) odds[k] = c; };

  const ft = findMarket(bts, 'FT 1X2');
  if (ft) for (const o of ft.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === '1') set('match_1', c);
    else if (n === 'x') set('match_X', c);
    else if (n === '2') set('match_2', c);
  }
  const dc = findMarket(bts, 'Double Chance');
  if (dc) for (const o of dc.odds || []) {
    const n = lbl(o).replace(/\s/g, ''), c = priceOf(o);
    if (n === '1x') set('dc_1X', c);
    else if (n === '12') set('dc_12', c);
    else if (n === 'x2') set('dc_X2', c);
  }
  const gg = findMarket(bts, 'GG/NG');
  if (gg) for (const o of gg.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === 'yes') set('btts_yes', c);
    else if (n === 'no') set('btts_no', c);
  }
  const uo = findMarket(bts, 'Under/Over');
  if (uo) for (const o of uo.odds || []) {
    const l = lineOf(o); if (!isHalfLine(l)) continue;
    const n = lbl(o), c = priceOf(o);
    if (n === 'over') set(`match_over_${l}`, c);
    else if (n === 'under') set(`match_under_${l}`, c);
  }
  const htr = findMarket(bts, 'HT 1X2');
  if (htr) for (const o of htr.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === '1') set('ht_match_1', c);
    else if (n === 'x') set('ht_match_X', c);
    else if (n === '2') set('ht_match_2', c);
  }
  const htuo = findMarket(bts, 'HT U/O');
  if (htuo) for (const o of htuo.odds || []) {
    const l = lineOf(o); if (!isHalfLine(l)) continue;
    const n = lbl(o), c = priceOf(o);
    if (n === 'over') set(`ht_over_${l}`, c);
    else if (n === 'under') set(`ht_under_${l}`, c);
  }
  const sh = findMarket(bts, '2nd Half : 1X2');
  if (sh) for (const o of sh.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === '1') set('h2_match_1', c);
    else if (n === 'x') set('h2_match_X', c);
    else if (n === '2') set('h2_match_2', c);
  }
  const sht = findMarket(bts, '2nd Half : Totals');
  if (sht) for (const o of sht.odds || []) {
    const l = lineOf(o); if (!isHalfLine(l)) continue;
    const n = lbl(o), c = priceOf(o);
    if (n === 'over') set(`h2_over_${l}`, c);
    else if (n === 'under') set(`h2_under_${l}`, c);
  }
  const dnb = findMarket(bts, 'Draw No Bet');
  if (dnb) for (const o of dnb.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === '1') set('dnb_1', c);
    else if (n === '2') set('dnb_2', c);
  }
  const oe = findMarket(bts, 'Odd/Even goals');
  if (oe) for (const o of oe.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === 'odd') set('odd', c);
    else if (n === 'even') set('even', c);
  }

  // Garde-fou totaux : marge aberrante (< 0.9) → paire supprimée.
  for (const pfx of ['match_', 'ht_', 'h2_']) {
    for (const k of Object.keys(odds)) {
      const m = k.match(new RegExp(`^${pfx}over_(-?\\d+(?:\\.\\d+)?)$`));
      if (!m) continue;
      const uk = `${pfx}under_${m[1]}`;
      if (odds[k] && odds[uk] && (1 / odds[k] + 1 / odds[uk]) < 0.9) { delete odds[k]; delete odds[uk]; }
    }
  }
  return odds;
}
