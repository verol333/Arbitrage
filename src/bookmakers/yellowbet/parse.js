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

// Normalise un nom d'equipe pour matching : minuscules + suppression accents
// + suppression tokens communs (fc/sc/…), suffit ici pour comparer au libelle
// de marche YellowBet ("Kuopion Palloseura total" contient toujours le nom).
function normTeam(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function yellowbetFlatOdds(bts, { home = '', away = '' } = {}) {
  const odds = {};
  if (!Array.isArray(bts)) return odds;
  const set = (k, c) => { if (c && (!odds[k] || c > odds[k])) odds[k] = c; };
  const homeN = normTeam(home);
  const awayN = normTeam(away);

  // Match winner : "FT 1X2" (foot) OR "2 Way" (tennis/volley 2-outcomes).
  // Confirme via audit raw : tennis YB expose "2 Way" avec outcomes 1/2.
  const ft = findMarket(bts, 'FT 1X2') || findMarket(bts, '2 Way')
    || findMarket(bts, 'Match Winner') || findMarket(bts, 'Winner')
    || findMarket(bts, 'Match result');
  if (ft) for (const o of ft.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === '1' || n === 'w1' || n === 'p1') set('match_1', c);
    else if (n === 'x' || n === 'draw') set('match_X', c);
    else if (n === '2' || n === 'w2' || n === 'p2') set('match_2', c);
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
  // Total match : "Under/Over" (foot) OR "Total Games" (tennis).
  const uo = findMarket(bts, 'Under/Over') || findMarket(bts, 'Total Games');
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
  const oe = findMarket(bts, 'Odd/Even goals') || findMarket(bts, 'Odd/even games');
  if (oe) for (const o of oe.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === 'odd') set('odd', c);
    else if (n === 'even') set('even', c);
  }
  // ─── TENNIS-specific : per-set winners + total sets ──────────────────────
  // 1st Set Winner (2 outcomes 1/2).
  const s1w = findMarket(bts, '1st Set Winner');
  if (s1w) for (const o of s1w.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === '1') set('s1_match_1', c);
    else if (n === '2') set('s1_match_2', c);
  }
  const s2w = findMarket(bts, 'Who wins second set') || findMarket(bts, '2nd Set Winner');
  if (s2w) for (const o of s2w.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === '1') set('s2_match_1', c);
    else if (n === '2') set('s2_match_2', c);
  }
  const s3w = findMarket(bts, 'Who wins third set') || findMarket(bts, '3rd Set Winner');
  if (s3w) for (const o of s3w.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === '1') set('s3_match_1', c);
    else if (n === '2') set('s3_match_2', c);
  }
  // 1st set total games (Over/Under with lines).
  const s1t = findMarket(bts, '1st set - total games');
  if (s1t) for (const o of s1t.odds || []) {
    const l = lineOf(o); if (!isHalfLine(l)) continue;
    const n = lbl(o), c = priceOf(o);
    if (n === 'over') set(`s1_over_${l}`, c);
    else if (n === 'under') set(`s1_under_${l}`, c);
  }
  const s2t = findMarket(bts, '2nd set - total games');
  if (s2t) for (const o of s2t.odds || []) {
    const l = lineOf(o); if (!isHalfLine(l)) continue;
    const n = lbl(o), c = priceOf(o);
    if (n === 'over') set(`s2_over_${l}`, c);
    else if (n === 'under') set(`s2_under_${l}`, c);
  }
  // 1st set game handicap.
  const s1h = findMarket(bts, '1st set - game handicap');
  if (s1h) for (const o of s1h.odds || []) {
    const l = lineOf(o); if (!isHalfLine(l)) continue;
    const n = lbl(o), c = priceOf(o);
    if (n === '1' || n === 'home') set(`s1_hcp_home_${l}`, c);
    else if (n === '2' || n === 'away') set(`s1_hcp_away_${-l}`, c);
  }
  // Total number of sets (best of 3) : "2 sets" / "3 sets" → set_over/under_2.5.
  const tns = findMarket(bts, 'Total number of sets (best of 3)')
    || findMarket(bts, 'Total number of sets (best of 5)');
  if (tns) for (const o of tns.odds || []) {
    const n = lbl(o), c = priceOf(o);
    // "2 sets" = pas plus de 2 → under 2.5. "3 sets" = plus de 2 → over 2.5.
    if (/^2\s*sets?$/.test(n)) set('set_under_2.5', c);
    else if (/^3\s*sets?$/.test(n)) set('set_over_2.5', c);
  }
  // Handicap YellowBet — TROIS variantes possibles (tennis surtout) :
  //   • "Handicap jeux" / "Games Handicap" → jeux gagnés (tennis main) → hcp_home_X
  //   • "Handicap sets" / "Set Handicap"    → sets gagnés (tennis)     → set_hcp_home_X
  //   • "European Handicap" (foot 3-way, l=0:1) → skip (line n'est pas un nombre)
  //   • "Handicap" seul ou "Asian Handicap" (foot) → Asian standard    → hcp_home_X
  // Sans distinction : le parser mélangeait les 2 types → cotes croisées mismatched.
  for (const mkt of bts.filter((m) => /handicap/i.test(m?.n || '') && !/corner/i.test(m?.n || ''))) {
    const name = String(mkt.n || '').toLowerCase();
    // Skip "European Handicap" (line = "0:1" format, pas un nombre demi-ligne)
    if (/european|europ.en/i.test(name)) continue;
    const isSets = /\bset(s)?\b/i.test(name);
    const isHt = /\bht\b|1st half/i.test(name);
    const isH2 = /\b2nd half\b/i.test(name);
    const pfx = isHt ? 'ht_' : isH2 ? 'h2_' : '';
    const keyBase = isSets ? 'set_hcp' : 'hcp';
    for (const o of mkt.odds || []) {
      const l = lineOf(o); if (!isHalfLine(l)) continue;
      const n = lbl(o), c = priceOf(o);
      if (n === '1' || n === 'home') set(`${pfx}${keyBase}_home_${l}`, c);
      else if (n === '2' || n === 'away') set(`${pfx}${keyBase}_away_${-l}`, c);
    }
  }
  // Individual totals. YellowBet expose ces marches sous 2 formats :
  //   1) Generique : "Team Total", "Home Total", "Away Total"
  //   2) Avec le nom de l'equipe : "Kuopion Palloseura total",
  //      "1st half - Sabah Masazir total", "2nd half - {team} total"
  // Le format (2) domine — on identifie le side via le nom de l'equipe passe
  // au parseur depuis index.js (match.home / match.away).
  for (const mkt of bts) {
    const raw = String(mkt?.n || '');
    const mn = normTeam(raw);
    if (!/total/.test(mn)) continue;
    // Skip marches non-individual : "total goals", "2nd half : totals", etc.
    if (/goals?( ranges?)?$|^total goals?$|total goals rangess?|halftime.fulltime|multigoal|exact/i.test(mn)) continue;
    if (/^total goals$|^under.over$|^ht u.o$|^2nd half\s*:\s*totals?$/i.test(mn)) continue;
    let side = null;
    if (/\bhome\b|\bteam\s*1\b|\b1st team\b/.test(mn)) side = 'home';
    else if (/\baway\b|\bteam\s*2\b|\b2nd team\b/.test(mn)) side = 'away';
    else if (homeN && mn.includes(homeN)) side = 'home';
    else if (awayN && mn.includes(awayN)) side = 'away';
    if (!side) continue;
    const isHt = /\bht\b|1st half/.test(mn);
    const isH2 = /\b2nd half\b/.test(mn);
    const pfx = isHt ? 'ht_' : isH2 ? 'h2_' : '';
    for (const o of mkt.odds || []) {
      const l = lineOf(o); if (!isHalfLine(l)) continue;
      const n = lbl(o), c = priceOf(o);
      if (n === 'over') set(`${pfx}tt_${side}_over_${l}`, c);
      else if (n === 'under') set(`${pfx}tt_${side}_under_${l}`, c);
    }
  }
  // HT Double Chance. YellowBet expose sous "1st Half Double Chance".
  const htdc = findMarket(bts, '1st Half Double Chance') || findMarket(bts, 'HT Double Chance');
  if (htdc) for (const o of htdc.odds || []) {
    const n = lbl(o).replace(/\s/g, ''), c = priceOf(o);
    if (n === '1x') set('ht_dc_1X', c);
    else if (n === '12') set('ht_dc_12', c);
    else if (n === 'x2') set('ht_dc_X2', c);
  }
  // HT BTTS. YellowBet : "1st Half : Goal Goal / No Goal" (y/n en shortcuts).
  const htgg = findMarket(bts, '1st Half : Goal Goal / No Goal') || findMarket(bts, 'HT GG/NG');
  if (htgg) for (const o of htgg.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === 'yes' || n === 'y') set('ht_btts_yes', c);
    else if (n === 'no' || n === 'n') set('ht_btts_no', c);
  }
  // HT DNB. YellowBet : "1st Half Draw no bet".
  const htdnb = findMarket(bts, '1st Half Draw no bet') || findMarket(bts, 'HT Draw No Bet');
  if (htdnb) for (const o of htdnb.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === '1') set('ht_dnb_1', c);
    else if (n === '2') set('ht_dnb_2', c);
  }
  // 2nd Half Double Chance. YellowBet : "2nd half : Double Chance".
  const h2dc = findMarket(bts, '2nd half : Double Chance') || findMarket(bts, '2nd Half : Double Chance');
  if (h2dc) for (const o of h2dc.odds || []) {
    const n = lbl(o).replace(/\s/g, ''), c = priceOf(o);
    if (n === '1x') set('h2_dc_1X', c);
    else if (n === '12') set('h2_dc_12', c);
    else if (n === 'x2') set('h2_dc_X2', c);
  }
  // 2nd Half BTTS. YellowBet : "2nd Half : Both Teams to score".
  const h2gg = findMarket(bts, '2nd Half : Both Teams to score') || findMarket(bts, '2nd Half : GG/NG');
  if (h2gg) for (const o of h2gg.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === 'yes' || n === 'y') set('h2_btts_yes', c);
    else if (n === 'no' || n === 'n') set('h2_btts_no', c);
  }
  // Corners total. YellowBet en live/prematch : "Total corners Under/Over"
  const cor = findMarket(bts, 'Total corners Under/Over')
    || findMarket(bts, 'Corners Under/Over') || findMarket(bts, 'Corners U/O');
  if (cor) for (const o of cor.odds || []) {
    const l = lineOf(o); if (!isHalfLine(l)) continue;
    const n = lbl(o), c = priceOf(o);
    if (n === 'over') set(`cor_over_${l}`, c);
    else if (n === 'under') set(`cor_under_${l}`, c);
  }
  // Corners HT total. YellowBet : "1st Half : Corners Under/Over"
  const corHt = findMarket(bts, '1st Half : Corners Under/Over')
    || findMarket(bts, 'HT Corners U/O') || findMarket(bts, 'HT Corners Under/Over');
  if (corHt) for (const o of corHt.odds || []) {
    const l = lineOf(o); if (!isHalfLine(l)) continue;
    const n = lbl(o), c = priceOf(o);
    if (n === 'over') set(`cor_ht_over_${l}`, c);
    else if (n === 'under') set(`cor_ht_under_${l}`, c);
  }
  // Corners handicap. YellowBet : "Corner handicap" (outcomes 1/2 + line dans o.l).
  const corHcp = findMarket(bts, 'Corner handicap') || findMarket(bts, 'Corners Handicap');
  if (corHcp) for (const o of corHcp.odds || []) {
    const l = lineOf(o); if (!isHalfLine(l)) continue;
    const n = lbl(o), c = priceOf(o);
    if (n === '1' || n === 'home') set(`cor_hcp_home_${l}`, c);
    else if (n === '2' || n === 'away') set(`cor_hcp_away_${-l}`, c);
  }
  // Corners handicap HT. YellowBet : "1st Half : Corner Handicap"
  const corHtHcp = findMarket(bts, '1st Half : Corner Handicap');
  if (corHtHcp) for (const o of corHtHcp.odds || []) {
    const l = lineOf(o); if (!isHalfLine(l)) continue;
    const n = lbl(o), c = priceOf(o);
    if (n === '1' || n === 'home') set(`cor_ht_hcp_home_${l}`, c);
    else if (n === '2' || n === 'away') set(`cor_ht_hcp_away_${-l}`, c);
  }
  // Corner Odd/Even. YellowBet : "Corner Odd/Even" et "1st Half : Corner Odd/Even"
  const corOe = findMarket(bts, 'Corner Odd/Even') || findMarket(bts, 'Corners Odd/Even');
  if (corOe) for (const o of corOe.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === 'odd') set('cor_odd', c);
    else if (n === 'even') set('cor_even', c);
  }
  // HT/H2 Odd/Even. YellowBet : "1st Half : Odd/Even Goals" et "2nd Half : Odd / Even".
  const htoe = findMarket(bts, '1st Half : Odd/Even Goals') || findMarket(bts, 'HT Odd/Even goals');
  if (htoe) for (const o of htoe.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === 'odd') set('ht_odd', c);
    else if (n === 'even') set('ht_even', c);
  }
  const h2oe = findMarket(bts, '2nd Half : Odd / Even')
    || findMarket(bts, '2nd Half : Odd/Even goals')
    || findMarket(bts, '2nd Half : Odd/Even Goals');
  if (h2oe) for (const o of h2oe.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === 'odd') set('h2_odd', c);
    else if (n === 'even') set('h2_even', c);
  }
  // Highest Scoring Half (3-way : 1st/2nd/Equal).
  const hsh = findMarket(bts, 'Highest Scoring Half');
  if (hsh) for (const o of hsh.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (/^1(st|)$|^first$/.test(n)) set('half_most_ht', c);
    else if (/^2(nd|)$|^second$/.test(n)) set('half_most_h2', c);
    else if (/^equal$|^tie$|^x$|^draw$/.test(n)) set('half_most_equal', c);
  }
  // First team to score (3-way : Home/Away/None).
  const fts = findMarket(bts, 'First Goal') || findMarket(bts, 'First Team To Score');
  if (fts) for (const o of fts.odds || []) {
    const n = lbl(o), c = priceOf(o);
    if (n === '1' || n === 'home' || n === 'h') set('fts_home', c);
    else if (n === '2' || n === 'away' || n === 'a') set('fts_away', c);
    else if (/no goal|none|no|neither/.test(n)) set('fts_none', c);
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
