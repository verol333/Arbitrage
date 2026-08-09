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

// YellowBet LIVE : les marchés totaux (Under/Over, Team Totals, HT/H2 totals)
// sont exposés en "REST OF MATCH" (buts restants à venir), PAS en total match.
// Preuve : match Libertad écrasant 0-3+, YB dit "under 1.5 = 1.01" (99%) —
// impossible si c'était total match (déjà >3 buts marqués). Seule interprétation
// cohérente : "0-1 but supplémentaire d'ici la fin".
// Solution : en live, on préfixe ces clés avec "rest_" pour qu'elles ne soient
// PAS comparées avec les autres books (qui eux exposent TOTAL match).
// Marchés 1X2/DC/BTTS/Handicap restent stables (rien à changer).
export function yellowbetFlatOdds(bts, { live = false } = {}) {
  const odds = { _ids: {} };
  if (!Array.isArray(bts)) return odds;
  // Helper : ecrit odds[k] = c ET odds._ids[k] = { betTypeId, betTypeName,
  // oddKey, oddName, oddDisplayName, oddPrice } — champs requis par YellowBet
  // SaveCoupon /placebetsport (body inclut key "E{eventId}B{betTypeId}O{oddKey}"
  // + selections avec eventId, homeName, awayName, gameTime, isLive ajoutes par
  // collect.js). Le marche courant est bind via `mkt` (variable dans le scope
  // de chaque block for..of ci-dessous).
  let mkt = null;
  const set = (k, c, o) => {
    if (!c || (odds[k] && c <= odds[k])) return;
    odds[k] = c;
    if (!odds._ids) odds._ids = {};
    if (mkt && o) {
      odds._ids[k] = {
        betTypeId: mkt?.id,
        betTypeName: String(mkt?.n || ''),
        oddKey: String(o?.n ?? ''),
        oddName: String(o?.n ?? ''),
        oddDisplayName: String(o?.n ?? ''),
        oddPrice: c,
      };
    }
  };
  // Redirige les totaux vers "rest_*" en live (jamais comparé avec autres books)
  const totalKey = (k) => live ? k.replace(/^(match|ht|h2|cor|tt_home|tt_away|ht_tt_home|ht_tt_away|h2_tt_home|h2_tt_away)_/, 'rest_$1_') : k;

  const ft = findMarket(bts, 'FT 1X2');
  mkt = ft; if (ft) for (const o of ft.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === '1') set('match_1', c, o);
    else if (n === 'x') set('match_X', c, o);
    else if (n === '2') set('match_2', c, o);
  }
  const dc = findMarket(bts, 'Double Chance');
  mkt = dc; if (dc) for (const o of dc.odds || []) {
    const n = lbl(o).replace(/\s/g, ''), c = priceOf(o);
    if (n === '1x') set('dc_1X', c, o);
    else if (n === '12') set('dc_12', c, o);
    else if (n === 'x2') set('dc_X2', c, o);
  }
  const gg = findMarket(bts, 'GG/NG');
  mkt = gg; if (gg) for (const o of gg.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === 'yes') set('btts_yes', c, o);
    else if (n === 'no') set('btts_no', c, o);
  }
  const uo = findMarket(bts, 'Under/Over');
  mkt = uo; if (uo) for (const o of uo.odds || []) {
    const l = lineOf(o); if (!isHalfLine(l)) continue;
    const n = lbl(o), c = priceOf(o);
    if (n === 'over') set(totalKey(`match_over_${l}`), c, o);
    else if (n === 'under') set(totalKey(`match_under_${l}`), c, o);
  }
  const htr = findMarket(bts, 'HT 1X2');
  mkt = htr; if (htr) for (const o of htr.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === '1') set('ht_match_1', c, o);
    else if (n === 'x') set('ht_match_X', c, o);
    else if (n === '2') set('ht_match_2', c, o);
  }
  const htuo = findMarket(bts, 'HT U/O');
  mkt = htuo; if (htuo) for (const o of htuo.odds || []) {
    const l = lineOf(o); if (!isHalfLine(l)) continue;
    const n = lbl(o), c = priceOf(o);
    if (n === 'over') set(totalKey(`ht_over_${l}`), c, o);
    else if (n === 'under') set(totalKey(`ht_under_${l}`), c, o);
  }
  const sh = findMarket(bts, '2nd Half : 1X2');
  mkt = sh; if (sh) for (const o of sh.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === '1') set('h2_match_1', c, o);
    else if (n === 'x') set('h2_match_X', c, o);
    else if (n === '2') set('h2_match_2', c, o);
  }
  const sht = findMarket(bts, '2nd Half : Totals');
  mkt = sht; if (sht) for (const o of sht.odds || []) {
    const l = lineOf(o); if (!isHalfLine(l)) continue;
    const n = lbl(o), c = priceOf(o);
    if (n === 'over') set(totalKey(`h2_over_${l}`), c, o);
    else if (n === 'under') set(totalKey(`h2_under_${l}`), c, o);
  }
  const dnb = findMarket(bts, 'Draw No Bet');
  mkt = dnb; if (dnb) for (const o of dnb.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === '1') set('dnb_1', c, o);
    else if (n === '2') set('dnb_2', c, o);
  }
  const oe = findMarket(bts, 'Odd/Even goals');
  mkt = oe; if (oe) for (const o of oe.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === 'odd') set('odd', c, o);
    else if (n === 'even') set('even', c, o);
  }
  // Handicap YellowBet (football uniquement) — 2 variantes acceptées :
  //   • "Asian Handicap" / "Handicap" seul → hcp_home_X (demi-lignes 2-way)
  //   • Préfixé "HT"/"1st half" → ht_hcp_*   |   "2nd half" → h2_hcp_*
  // Skip : "European Handicap" (3-way, line "0:1" pas un nombre demi-ligne).
  for (const mktLoop of bts.filter((m) => /handicap/i.test(m?.n || '') && !/corner/i.test(m?.n || ''))) {
    mkt = mktLoop;
    const name = String(mkt.n || '').toLowerCase();
    if (/european|europ.en/i.test(name)) continue;
    const isHt = /\bht\b|1st half/i.test(name);
    const isH2 = /\b2nd half\b/i.test(name);
    const pfx = isHt ? 'ht_' : isH2 ? 'h2_' : '';
    for (const o of mkt.odds || []) {
      const l = lineOf(o); if (!isHalfLine(l)) continue;
      const n = lbl(o), c = priceOf(o);
      if (n === '1' || n === 'home') set(`${pfx}hcp_home_${l}`, c, o);
      else if (n === '2' || n === 'away') set(`${pfx}hcp_away_${-l}`, c, o);
    }
  }
  // Individual totals.
  for (const mktLoop of bts) {
    mkt = mktLoop;
    const mn = (mkt?.n || '').toLowerCase();
    if (!/team.*total|individual.*total|home.*total|away.*total/i.test(mn)) continue;
    const isHome = /home|team\s*1|1st team/i.test(mn);
    const isAway = /away|team\s*2|2nd team/i.test(mn);
    if (!isHome && !isAway) continue;
    const side = isHome ? 'home' : 'away';
    const isHt = /\bht\b|1st half/i.test(mn);
    const isH2 = /\b2nd half\b/i.test(mn);
    const pfx = isHt ? 'ht_' : isH2 ? 'h2_' : '';
    for (const o of mkt.odds || []) {
      const l = lineOf(o); if (!isHalfLine(l)) continue;
      const n = lbl(o), c = priceOf(o);
      if (n === 'over') set(totalKey(`${pfx}tt_${side}_over_${l}`), c, o);
      else if (n === 'under') set(totalKey(`${pfx}tt_${side}_under_${l}`), c, o);
    }
  }
  // HT Double Chance.
  const htdc = findMarket(bts, 'HT Double Chance');
  mkt = htdc; if (htdc) for (const o of htdc.odds || []) {
    const n = lbl(o).replace(/\s/g, ''), c = priceOf(o);
    if (n === '1x') set('ht_dc_1X', c, o);
    else if (n === '12') set('ht_dc_12', c, o);
    else if (n === 'x2') set('ht_dc_X2', c, o);
  }
  // HT BTTS.
  const htgg = findMarket(bts, 'HT GG/NG');
  mkt = htgg; if (htgg) for (const o of htgg.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === 'yes') set('ht_btts_yes', c, o);
    else if (n === 'no') set('ht_btts_no', c, o);
  }
  // 2nd Half Double Chance.
  const h2dc = findMarket(bts, '2nd Half : Double Chance');
  mkt = h2dc; if (h2dc) for (const o of h2dc.odds || []) {
    const n = lbl(o).replace(/\s/g, ''), c = priceOf(o);
    if (n === '1x') set('h2_dc_1X', c, o);
    else if (n === '12') set('h2_dc_12', c, o);
    else if (n === 'x2') set('h2_dc_X2', c, o);
  }
  // 2nd Half BTTS.
  const h2gg = findMarket(bts, '2nd Half : GG/NG');
  mkt = h2gg; if (h2gg) for (const o of h2gg.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === 'yes') set('h2_btts_yes', c, o);
    else if (n === 'no') set('h2_btts_no', c, o);
  }
  // Corners total.
  const cor = findMarket(bts, 'Corners Under/Over') || findMarket(bts, 'Corners U/O');
  mkt = cor; if (cor) for (const o of cor.odds || []) {
    const l = lineOf(o); if (!isHalfLine(l)) continue;
    const n = lbl(o), c = priceOf(o);
    if (n === 'over') set(totalKey(`cor_over_${l}`), c, o);
    else if (n === 'under') set(totalKey(`cor_under_${l}`), c, o);
  }
  // Corners HT total.
  const corHt = findMarket(bts, 'HT Corners U/O') || findMarket(bts, 'HT Corners Under/Over');
  mkt = corHt; if (corHt) for (const o of corHt.odds || []) {
    const l = lineOf(o); if (!isHalfLine(l)) continue;
    const n = lbl(o), c = priceOf(o);
    if (n === 'over') set(totalKey(`cor_ht_over_${l}`), c, o);
    else if (n === 'under') set(totalKey(`cor_ht_under_${l}`), c, o);
  }
  // HT/H2 Odd/Even.
  const htoe = findMarket(bts, 'HT Odd/Even goals');
  mkt = htoe; if (htoe) for (const o of htoe.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === 'odd') set('ht_odd', c, o);
    else if (n === 'even') set('ht_even', c, o);
  }
  const h2oe = findMarket(bts, '2nd Half : Odd/Even goals');
  mkt = h2oe; if (h2oe) for (const o of h2oe.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === 'odd') set('h2_odd', c, o);
    else if (n === 'even') set('h2_even', c, o);
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
