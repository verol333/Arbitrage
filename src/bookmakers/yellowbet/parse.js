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
        market_name_native: String(mkt?.n || ''),
        selection_name_native: String(o?.n ?? ''),
        market_path_native: null,
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
  // 1st Half Draw no bet (nom exact YB avec "no bet" lowercase — audit 2026-08-11)
  const dnbHt = findMarket(bts, '1st Half Draw no bet');
  mkt = dnbHt; if (dnbHt) for (const o of dnbHt.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === '1') set('ht_dnb_1', c, o);
    else if (n === '2') set('ht_dnb_2', c, o);
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

// ─── BASKET (marches incl OT, 2-way : pas de X) ─────────────────────────
// Noms de marches YB basket verifies via probe-yb-basket-markets run
// 31326074838 (Mogi das Cruzes, Paulista) :
//   "2 Way (incl. overtime)"   → match_1/match_2 (Winner incl OT, VRAI 2-way)
//   "FT 1X2"                    → SKIP (basket sans OT, cross-book utilise incl OT)
//   "Total (Incl. OT)" /
//     "Total (incl. overtime)"  → match_over_L / match_under_L
//   "Asian Handicap"            → hcp_home_L / hcp_away_-L (demi-lignes)
//   "Handicap (incl. overtime)" → SKIP (lignes entieres → push possible)
//   "European Handicap"         → SKIP (3-way)
//   "1st Half : Asian Handicap" → ht_hcp_home_L / ht_hcp_away_-L
//   "2nd Half : Asian Handicap" → h2_hcp_home_L / h2_hcp_away_-L
//   "1st Half : Total Spreads"  → ht_over_L / ht_under_L
//   "1st Quarter : Total Spread"→ q1_over_L / q1_under_L
//   "2nd Quarter : Total Spread"→ q2_over_L / q2_under_L
//   "3rd Quarter : Total Spread"→ q3_over_L / q3_under_L
//   "3rd Quarter : Points Spread"→ q3_hcp_home_L / q3_hcp_away_-L
//   "4th Quarter : Total Spread"→ q4_over_L / q4_under_L
//   "Draw no bet"               → dnb_1 / dnb_2
//   "Odd/Even Points"           → odd / even
// ═══════════════════════════════════════════════════════════════
// PARSEUR TENNIS YellowBet (audit 2026-08-11 : 37 matchs dispo).
// YB tennis expose 20 marches dont 10+ cross-book utiles.
// Convention keys : match_1/2, hcp_home/away_L, match_over/under_L,
// tt_home/away_over/under_L, hcp_sets_home/away_L, s1_/s2_ prefixes,
// total_sets_2/3, odd/even.
// ═══════════════════════════════════════════════════════════════
export function yellowbetTennisFlatOdds(bts, { home = '', away = '' } = {}) {
  const odds = { _ids: {} };
  if (!Array.isArray(bts)) return odds;
  let mkt = null;
  const put = (k, c, o) => {
    if (!c || (odds[k] && c <= odds[k])) return;
    odds[k] = c;
    if (mkt && o) {
      odds._ids[k] = {
        betTypeId: mkt?.id, betTypeName: String(mkt?.n || ''),
        oddKey: String(o?.n ?? ''), oddName: String(o?.n ?? ''),
        oddDisplayName: String(o?.n ?? ''), oddPrice: c,
        market_name_native: String(mkt?.n || ''),
        selection_name_native: String(o?.n ?? ''),
        market_path_native: null,
      };
    }
  };
  // Norm player name pour matching tt_home / tt_away sur "{Player} total games"
  const homeLc = String(home || '').toLowerCase();
  const awayLc = String(away || '').toLowerCase();
  const isHomeName = (n) => homeLc && n.includes(homeLc.split(',')[0].trim().toLowerCase().slice(0, 4));
  const isAwayName = (n) => awayLc && n.includes(awayLc.split(',')[0].trim().toLowerCase().slice(0, 4));

  for (const b of bts) {
    const name = String(b?.n || '').trim();
    const nameLc = name.toLowerCase();
    mkt = b;

    // ─── Vainqueur du match (2-way, tennis pas de nul)
    if (/^2\s*way$/i.test(name)) {
      for (const o of b.odds || []) {
        const n = lbl(o), c = priceOf(o);
        if (n === '1') put('match_1', c, o);
        else if (n === '2') put('match_2', c, o);
      }
      continue;
    }
    // ─── Vainqueur 1er / 2eme set
    if (/^1st\s+set\s+winner$/i.test(name)) {
      for (const o of b.odds || []) {
        const n = lbl(o), c = priceOf(o);
        if (n === '1') put('s1_match_1', c, o);
        else if (n === '2') put('s1_match_2', c, o);
      }
      continue;
    }
    if (/^who\s+wins\s+second\s+set$/i.test(name)) {
      for (const o of b.odds || []) {
        const n = lbl(o), c = priceOf(o);
        if (n === '1') put('s2_match_1', c, o);
        else if (n === '2') put('s2_match_2', c, o);
      }
      continue;
    }
    // ─── Total Games match
    if (/^total\s+games$/i.test(name)) {
      for (const o of b.odds || []) {
        const l = lineOf(o); if (!isHalfLine(l)) continue;
        const n = lbl(o), c = priceOf(o);
        if (n === 'over') put(`match_over_${l}`, c, o);
        else if (n === 'under') put(`match_under_${l}`, c, o);
      }
      continue;
    }
    // ─── 1st set - total games
    if (/^1st\s+set\s*-\s*total\s+games$/i.test(name)) {
      for (const o of b.odds || []) {
        const l = lineOf(o); if (!isHalfLine(l)) continue;
        const n = lbl(o), c = priceOf(o);
        if (n === 'over') put(`s1_over_${l}`, c, o);
        else if (n === 'under') put(`s1_under_${l}`, c, o);
      }
      continue;
    }
    // ─── Game Handicap match (2-way sur jeux)
    if (/^game\s+handicap$/i.test(name)) {
      for (const o of b.odds || []) {
        const l = lineOf(o); if (!isHalfLine(Math.abs(l))) continue;
        const n = lbl(o), c = priceOf(o);
        if (n === '1') put(`hcp_home_${l}`, c, o);
        else if (n === '2') put(`hcp_away_${-l}`, c, o);
      }
      continue;
    }
    // ─── 1st set - game handicap
    if (/^1st\s+set\s*-\s*game\s+handicap$/i.test(name)) {
      for (const o of b.odds || []) {
        const l = lineOf(o); if (!isHalfLine(Math.abs(l))) continue;
        const n = lbl(o), c = priceOf(o);
        if (n === '1') put(`s1_hcp_home_${l}`, c, o);
        else if (n === '2') put(`s1_hcp_away_${-l}`, c, o);
      }
      continue;
    }
    // ─── Set Handicap (sets gagnes, ±1.5)
    if (/^set\s+handicap$/i.test(name)) {
      for (const o of b.odds || []) {
        const l = lineOf(o); if (!isHalfLine(Math.abs(l))) continue;
        const n = lbl(o), c = priceOf(o);
        if (n === '1') put(`hcp_sets_home_${l}`, c, o);
        else if (n === '2') put(`hcp_sets_away_${-l}`, c, o);
      }
      continue;
    }
    // ─── Total number of sets (best of 3) → outcome 2 ou 3 sets
    if (/^total\s+number\s+of\s+sets/i.test(name)) {
      for (const o of b.odds || []) {
        const n = lbl(o), c = priceOf(o);
        if (n === '2') put('total_sets_2', c, o);
        else if (n === '3') put('total_sets_3', c, o);
      }
      continue;
    }
    // ─── Odd/even games (match)
    if (/^odd\/even\s+games$/i.test(name)) {
      for (const o of b.odds || []) {
        const n = lbl(o), c = priceOf(o);
        if (n === 'odd') put('odd', c, o);
        else if (n === 'even') put('even', c, o);
      }
      continue;
    }
    // ─── Player total games : "{Player} total games" → tt_home / tt_away
    const ttMatch = nameLc.match(/^(.+?)\s+total\s+games$/);
    if (ttMatch) {
      const playerLc = ttMatch[1];
      const side = isHomeName(playerLc) ? 'home' : isAwayName(playerLc) ? 'away' : null;
      if (!side) continue;
      for (const o of b.odds || []) {
        const l = lineOf(o); if (!isHalfLine(l)) continue;
        const n = lbl(o), c = priceOf(o);
        if (n === 'over') put(`tt_${side}_over_${l}`, c, o);
        else if (n === 'under') put(`tt_${side}_under_${l}`, c, o);
      }
      continue;
    }
    // Skip explicites : "Correct Set Score", "1st set - correct score",
    // "Any set to nil", "Double result", "{Player} to win a set",
    // "{Player} to win exactly 1 set" (tous non arbitrables cross-book).
  }
  return odds;
}

export function yellowbetBasketFlatOdds(bts, { live = false } = {}) {
  const odds = { _ids: {} };
  if (!Array.isArray(bts)) return odds;
  let mkt = null;
  const put = (k, c, o) => {
    if (!c || (odds[k] && c <= odds[k])) return;
    odds[k] = c;
    if (mkt && o) {
      odds._ids[k] = {
        betTypeId: mkt?.id,
        betTypeName: String(mkt?.n || ''),
        oddKey: String(o?.n ?? ''),
        oddName: String(o?.n ?? ''),
        oddDisplayName: String(o?.n ?? ''),
        oddPrice: c,
        market_name_native: String(mkt?.n || ''),
        selection_name_native: String(o?.n ?? ''),
        market_path_native: null,
      };
    }
  };

  // Iteration principale par nom exact.
  for (const b of bts) {
    const name = String(b?.n || '').trim();
    const nameLc = name.toLowerCase();
    mkt = b;

    // ─── Winner FT incl OT (2-way, pas de X — le vrai match Winner basket)
    if (/^2\s*way.*overtime/i.test(name)) {
      for (const o of b.odds || []) {
        const n = lbl(o), c = priceOf(o);
        if (n === '1') put('match_1', c, o);
        else if (n === '2') put('match_2', c, o);
      }
      continue;
    }

    // ─── Total points incl OT (main market)
    if (/^total\s*\(?\s*incl\.?\s*(?:overtime|ot)/i.test(name)) {
      for (const o of b.odds || []) {
        const l = lineOf(o); if (!isHalfLine(l)) continue;
        const n = lbl(o), c = priceOf(o);
        if (n === 'over') put(`match_over_${l}`, c, o);
        else if (n === 'under') put(`match_under_${l}`, c, o);
      }
      continue;
    }

    // ─── Asian Handicap FT (main handicap incl OT)
    if (/^asian\s+handicap$/i.test(name)) {
      for (const o of b.odds || []) {
        const l = lineOf(o); if (!isHalfLine(l)) continue;
        const n = lbl(o), c = priceOf(o);
        if (n === '1') put(`hcp_home_${l}`, c, o);
        else if (n === '2') put(`hcp_away_${-l}`, c, o);
      }
      continue;
    }

    // ─── Draw No Bet (2-way sans nul, incl OT)
    if (/^draw\s*no\s*bet$/i.test(name)) {
      for (const o of b.odds || []) {
        const n = lbl(o), c = priceOf(o);
        if (n === '1') put('dnb_1', c, o);
        else if (n === '2') put('dnb_2', c, o);
      }
      continue;
    }

    // ─── Odd/Even Points
    if (/^odd\/even\s+points/i.test(name)) {
      for (const o of b.odds || []) {
        const n = lbl(o), c = priceOf(o);
        if (n === 'odd') put('odd', c, o);
        else if (n === 'even') put('even', c, o);
      }
      continue;
    }

    // ─── 1st Half : Asian Handicap
    if (/^1st\s+half\s*:\s*asian\s+handicap/i.test(name)) {
      for (const o of b.odds || []) {
        const l = lineOf(o); if (!isHalfLine(l)) continue;
        const n = lbl(o), c = priceOf(o);
        if (n === '1') put(`ht_hcp_home_${l}`, c, o);
        else if (n === '2') put(`ht_hcp_away_${-l}`, c, o);
      }
      continue;
    }

    // ─── 2nd Half : Asian Handicap
    if (/^2nd\s+half\s*:\s*asian\s+handicap/i.test(name)) {
      for (const o of b.odds || []) {
        const l = lineOf(o); if (!isHalfLine(l)) continue;
        const n = lbl(o), c = priceOf(o);
        if (n === '1') put(`h2_hcp_home_${l}`, c, o);
        else if (n === '2') put(`h2_hcp_away_${-l}`, c, o);
      }
      continue;
    }

    // ─── 1st Half : Total Spreads
    if (/^1st\s+half\s*:\s*total\s*(?:spreads?)?/i.test(name)) {
      for (const o of b.odds || []) {
        const l = lineOf(o); if (!isHalfLine(l)) continue;
        const n = lbl(o), c = priceOf(o);
        if (n === 'over') put(`ht_over_${l}`, c, o);
        else if (n === 'under') put(`ht_under_${l}`, c, o);
      }
      continue;
    }

    // ─── Quarter totals (1st/2nd/3rd/4th Quarter : Total Spread)
    const qTot = name.match(/^(1st|2nd|3rd|4th)\s+quarter\s*:\s*total\s*spread/i);
    if (qTot) {
      const qMap = { '1st': 'q1_', '2nd': 'q2_', '3rd': 'q3_', '4th': 'q4_' };
      const pfx = qMap[qTot[1].toLowerCase()];
      for (const o of b.odds || []) {
        const l = lineOf(o); if (!isHalfLine(l)) continue;
        const n = lbl(o), c = priceOf(o);
        if (n === 'over') put(`${pfx}over_${l}`, c, o);
        else if (n === 'under') put(`${pfx}under_${l}`, c, o);
      }
      continue;
    }

    // ─── Quarter handicap (1st/2nd/3rd/4th Quarter : Points Spread)
    const qHcp = name.match(/^(1st|2nd|3rd|4th)\s+quarter\s*:\s*points?\s*spread/i);
    if (qHcp) {
      const qMap = { '1st': 'q1_', '2nd': 'q2_', '3rd': 'q3_', '4th': 'q4_' };
      const pfx = qMap[qHcp[1].toLowerCase()];
      for (const o of b.odds || []) {
        const l = lineOf(o); if (!isHalfLine(l)) continue;
        const n = lbl(o), c = priceOf(o);
        if (n === '1') put(`${pfx}hcp_home_${l}`, c, o);
        else if (n === '2') put(`${pfx}hcp_away_${-l}`, c, o);
      }
      continue;
    }

    // Skip explicites (documentes) :
    //   "FT 1X2"                     : basket sans OT (cross-book utilise incl OT)
    //   "Handicap (incl. overtime)"  : lignes ENTIERES → push possible, pas d'arb garanti
    //   "European Handicap"          : 3-way, ligne "0:16" non-numerique
    //   "Overtime Yes/No"            : proposition side, pas arbitrable cross-book
    //   "Total margins Regular:ranges" : ranges non-2-way
    //   "Winner & total (incl. overtime)" : combo, pas arbitrable
    //   "Winning Margins"            : ranges non-2-way
    //   "*total (incl. overtime)"    : totaux INDIVIDUELS par equipe → tt_home/tt_away
    // Individual team totals (basket) — YB expose "{TeamName} total (incl. overtime)"
    if (/total\s*\(?\s*incl\.?\s*(?:overtime|ot)/i.test(nameLc) && !/^total/i.test(nameLc)) {
      // Nom du type "CA Paulistano SP total (incl. overtime)" ou "Mogi das Cruzes total ..."
      // On ne connait pas le mapping team→home/away sans context supplementaire
      // (le nom equipe n'est pas dans le parseur, seulement match.home/away).
      // A ajouter plus tard si besoin — skip pour l'instant.
      continue;
    }
  }

  return odds;
}
