// Parseur foot Casongo (Velisports). Consomme le JSON complet retourné par
// GetMatchById (Ms[] = markets, chaque market a des Ss[] = selections). On mappe
// les marketTypeIds (Ms.TI) vers notre vocabulaire arbitrage (match_1, dc_1X,
// match_over_<L>, ...). Chaque selection porte un SI (SelectionId) unique — on
// le stocke dans _ids[key] pour permettre au backend de reconstruire le code
// coupon casongo (endpoint /placeBet côté Velisports).
import { isHalfLine } from '../../core/markets.js';

// Mapping TI (MarketTypeId Velisports) → prefix + parser.
// Sq (Sequence) distingue les 1ère mi-temps / 2ème mi-temps quand plusieurs
// marchés partagent le même TI (mais Velisports utilise en pratique des TI
// distincts pour 1H vs 2H — Sq est de la ceinture-bretelles).

export function casongoFlatOdds(matchJson, { sport = 'football' } = {}) {
  if (sport !== 'football') return {};
  if (!matchJson?.Ms?.length) return {};
  const matchId = matchJson.MI;
  const home = matchJson.Cs?.find((c) => c.O === 1)?.TN || '';
  const away = matchJson.Cs?.find((c) => c.O === 2)?.TN || '';
  const readAt = Date.now();
  const odds = { _ids: {} };
  const put = (key, sel) => {
    const price = Number(sel.C);
    if (!Number.isFinite(price) || price <= 1.01) return;
    odds[key] = price;
    odds._ids[key] = { book: 'casongo', matchId, selectionId: sel.SI, price, read_at: readAt };
  };

  // Lecture 1X2 : Ss.H = "1" | "X" | "2".
  const read1x2 = (ss, pfx) => {
    for (const s of ss) {
      const h = (s.H || '').trim();
      if (h === '1') put(`${pfx}match_1`, s);
      else if (h === 'X' || h === 'x') put(`${pfx}match_X`, s);
      else if (h === '2') put(`${pfx}match_2`, s);
    }
  };
  // Double chance : Ss.H = "1X" | "12" | "X2".
  const readDC = (ss, pfx) => {
    for (const s of ss) {
      const h = (s.H || '').replace(/\s/g, '').toUpperCase();
      if (h === '1X') put(`${pfx}dc_1X`, s);
      else if (h === '12' || h === '12.0') put(`${pfx}dc_12`, s);
      else if (h === 'X2') put(`${pfx}dc_X2`, s);
    }
  };
  // BTTS : Ss.H = "Oui" | "Non".
  const readBTTS = (ss, pfx) => {
    for (const s of ss) {
      const h = (s.H || '').toLowerCase();
      if (/^oui$|^yes$/.test(h)) put(`${pfx}btts_yes`, s);
      else if (/^non$|^no$/.test(h)) put(`${pfx}btts_no`, s);
    }
  };
  // Total Over/Under : Ss.H = "Plus" | "Moins", Ss.LN = ligne côté sel.
  // Filtre .5 (pas .25/.75) pour cohérence avec les autres books arbitrables.
  const readTotal = (ss, overKey, underKey) => {
    for (const s of ss) {
      const line = Number(s.LN);
      if (!isHalfLine(line)) continue;
      const h = (s.H || '').toLowerCase();
      if (h === 'plus') put(overKey(line), s);
      else if (h === 'moins') put(underKey(line), s);
    }
  };
  // Draw No Bet : Ss.H = "1" | "2".
  const readDNB = (ss, pfx) => {
    for (const s of ss) {
      const h = (s.H || '').trim();
      if (h === '1') put(`${pfx}dnb_1`, s);
      else if (h === '2') put(`${pfx}dnb_2`, s);
    }
  };
  // Asian Handicap : Ss.H = "1" | "2", Ss.LN = handicap signé côté sel.
  const readAH = (ss, pfx) => {
    for (const s of ss) {
      const line = Number(s.LN);
      if (!isHalfLine(line)) continue;
      const h = (s.H || '').trim();
      if (h === '1' || h === '1.0') put(`${pfx}hcp_home_${line}`, s);
      else if (h === '2' || h === '2.0') put(`${pfx}hcp_away_${line}`, s);
    }
  };
  // Odd/Even : Ss.H = "Impair" | "Pair".
  const readOddEven = (ss, pfx) => {
    for (const s of ss) {
      const h = (s.H || '').toLowerCase();
      if (/^impair$|^odd$/.test(h)) put(`${pfx}odd`, s);
      else if (/^pair$|^even$/.test(h)) put(`${pfx}even`, s);
    }
  };
  // Team total O/U (TI=30 pour home, TI=31 pour away) : Ss.H = "Plus" | "Moins".
  const readTeamTotal = (ss, side) => {
    for (const s of ss) {
      const line = Number(s.LN);
      if (!isHalfLine(line)) continue;
      const h = (s.H || '').toLowerCase();
      if (h === 'plus') put(`tt_${side}_over_${line}`, s);
      else if (h === 'moins') put(`tt_${side}_under_${line}`, s);
    }
  };
  // Half Most Goals (TI=90) : Ss.H = "1ère mi-temps" | "Nul" | "2ème mi-temps".
  const readHalfMost = (ss) => {
    for (const s of ss) {
      const h = (s.H || '').toLowerCase();
      if (/1(ère|ere|st)/.test(h)) put('half_most_ht', s);
      else if (/^nul$|^equal$|^x$|^draw$/.test(h)) put('half_most_equal', s);
      else if (/2(ème|eme|nd)/.test(h)) put('half_most_h2', s);
    }
  };
  // Corners Over/Under 2-way (TI=13) : même structure que Total.
  const readCornersTotal = (ss) => {
    for (const s of ss) {
      const line = Number(s.LN);
      if (!isHalfLine(line)) continue;
      const h = (s.H || '').toLowerCase();
      if (h === 'plus') put(`cor_over_${line}`, s);
      else if (h === 'moins') put(`cor_under_${line}`, s);
    }
  };

  for (const market of matchJson.Ms) {
    const ti = market.TI;
    const ss = (market.Ss || []).filter((s) => Number(s.C) > 1);
    if (!ss.length) continue;

    // ═══ Plein temps ═══
    if (ti === 1) read1x2(ss, '');                                           // Match Result 1X2
    else if (ti === 2) readDC(ss, '');                                       // Double Chance
    else if (ti === 3) readTotal(ss, (l) => `match_over_${l}`, (l) => `match_under_${l}`);  // Total O/U
    else if (ti === 4) readDNB(ss, '');                                      // DNB
    else if (ti === 5) readAH(ss, '');                                       // Asian Handicap
    else if (ti === 7) readBTTS(ss, '');                                     // BTTS
    else if (ti === 8) readOddEven(ss, '');                                  // Total Odd/Even
    else if (ti === 30) readTeamTotal(ss, 'home');                           // {t1} Total O/U
    else if (ti === 31) readTeamTotal(ss, 'away');                           // {t2} Total O/U
    else if (ti === 90) readHalfMost(ss);                                    // Half With Most Goals
    // ═══ 1ère mi-temps ═══
    else if (ti === 1046) read1x2(ss, 'ht_');                                // 1H Result
    else if (ti === 1075) readDC(ss, 'ht_');                                 // 1H DC
    else if (ti === 1050) readBTTS(ss, 'ht_');                               // 1H BTTS
    else if (ti === 1049) readTotal(ss, (l) => `ht_over_${l}`, (l) => `ht_under_${l}`);
    else if (ti === 1070) readDNB(ss, 'ht_');                                // 1H DNB
    else if (ti === 1073) readAH(ss, 'ht_');                                 // 1H Asian Handicap
    else if (ti === 1051) readOddEven(ss, 'ht_');                            // 1H Odd/Even
    // ═══ 2ème mi-temps ═══
    else if (ti === 1047) read1x2(ss, 'h2_');                                // 2H Result
    else if (ti === 1085) readDC(ss, 'h2_');                                 // 2H DC
    else if (ti === 1081) readBTTS(ss, 'h2_');                               // 2H BTTS
    else if (ti === 1048) readTotal(ss, (l) => `h2_over_${l}`, (l) => `h2_under_${l}`);
    else if (ti === 1093) readDNB(ss, 'h2_');                                // 2H DNB
    else if (ti === 1088) readAH(ss, 'h2_');                                 // 2H AH (3-way TI=1071 skip)
    else if (ti === 1092) readOddEven(ss, 'h2_');                            // 2H Odd/Even
    // ═══ Corners ═══
    else if (ti === 13) readCornersTotal(ss);                                // Total Corners O/U
    else if (ti === 18) readOddEven(ss, 'cor_');                             // Corners Odd/Even
  }
  return odds;
}
