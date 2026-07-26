// Parseur PremierBet nouveau backend sports-api.premierbet.com
// Structure : markets[{id, name, outcomes:[{id, name, value}]}]
// Market IDs mappés (extraits du dump user) :
//   3=1X2, 17=DC, 7=BTTS, 29=O/U, 87=Handicap Asiatique, 44=DNB
//   6=1MT 1X2, 96=2MT 1X2, 44=1MT O/U, 45=2MT O/U
//   353=Total Home, 352=Total Away
//   119=1MT BTTS, 120=2MT BTTS
//   155=1MT DC, 156=2MT DC
import { isHalfLine } from '../../core/markets.js';

function num(v) { const n = Number(v); return Number.isFinite(n) && n > 1 ? n : null; }
function findByName(outcomes, ...names) {
  const set = new Set(names.map((n) => String(n).toLowerCase()));
  for (const o of outcomes) if (set.has(String(o.name || '').toLowerCase())) return num(o.value);
  return null;
}
// Some markets encode line in name ("Over 2.5", "Under 2.5", "1 -1", "Home +1.5")
function extractLine(name) {
  const m = String(name).match(/[-+]?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// 1X2 / DC / DNB / BTTS style — outcomes fixes par nom
function put1x2(odds, market, pfx) {
  const outs = market.outcomes || [];
  const one = findByName(outs, '1', 'Home', 'Domicile');
  const draw = findByName(outs, 'X', 'Draw', 'Match nul', 'Nul');
  const two = findByName(outs, '2', 'Away', 'Extérieur');
  if (one) odds[`${pfx}match_1`] = one;
  if (draw) odds[`${pfx}match_X`] = draw;
  if (two) odds[`${pfx}match_2`] = two;
}
function putDC(odds, market, pfx) {
  const outs = market.outcomes || [];
  const oneX = findByName(outs, '1X', '1 ou X', 'Home or Draw');
  const twelve = findByName(outs, '12', '1 ou 2', 'Home or Away');
  const xTwo = findByName(outs, 'X2', 'X ou 2', 'Draw or Away');
  if (oneX) odds[`${pfx}dc_1X`] = oneX;
  if (twelve) odds[`${pfx}dc_12`] = twelve;
  if (xTwo) odds[`${pfx}dc_X2`] = xTwo;
}
function putBtts(odds, market, pfx) {
  const outs = market.outcomes || [];
  const yes = findByName(outs, 'Oui', 'Yes');
  const no = findByName(outs, 'Non', 'No');
  if (yes) odds[`${pfx}btts_yes`] = yes;
  if (no) odds[`${pfx}btts_no`] = no;
}
function putDnb(odds, market, pfx) {
  const outs = market.outcomes || [];
  const one = findByName(outs, '1', 'Home');
  const two = findByName(outs, '2', 'Away');
  if (one) odds[`${pfx}dnb_1`] = one;
  if (two) odds[`${pfx}dnb_2`] = two;
}

// Total O/U — parse "Plus X.X" / "Moins X.X" ou "Over X.X"/"Under X.X"
function putTotal(odds, market, pfx) {
  const outs = market.outcomes || [];
  let over = null, under = null, line = null;
  for (const o of outs) {
    const nm = String(o.name || '');
    const v = num(o.value);
    if (v == null) continue;
    const isOver = /^(plus|over|\+)/i.test(nm);
    const isUnder = /^(moins|under|-)/i.test(nm);
    const ln = extractLine(nm);
    if (ln != null && isHalfLine(ln)) {
      if (isOver && !over) { over = v; line = ln; }
      else if (isUnder && !under) { under = v; line = line ?? ln; }
    }
  }
  if (line != null && over && under) {
    odds[`${pfx}over_${line}`] = over;
    odds[`${pfx}under_${line}`] = under;
  }
}

// Team totals (Home/Away O/U)
function putTeamTotal(odds, market, side, pfx) {
  const outs = market.outcomes || [];
  let over = null, under = null, line = null;
  for (const o of outs) {
    const nm = String(o.name || '');
    const v = num(o.value);
    if (v == null) continue;
    const isOver = /(plus|over|\+)/i.test(nm);
    const isUnder = /(moins|under|-)/i.test(nm);
    const ln = extractLine(nm);
    if (ln != null && isHalfLine(ln)) {
      if (isOver && !over) { over = v; line = ln; }
      else if (isUnder && !under) { under = v; line = line ?? ln; }
    }
  }
  if (line != null && over && under) {
    odds[`${pfx}tt_${side}_over_${line}`] = over;
    odds[`${pfx}tt_${side}_under_${line}`] = under;
  }
}

// Handicap Asiatique — outcomes "1 -1.5" / "2 +1.5"
function putAsianHcp(odds, market) {
  const outs = market.outcomes || [];
  let home = null, away = null, line = null;
  for (const o of outs) {
    const nm = String(o.name || '');
    const v = num(o.value);
    if (v == null) continue;
    const ln = extractLine(nm);
    if (ln == null || !isHalfLine(Math.abs(ln))) continue;
    if (/^1\b/.test(nm) && !home) { home = v; line = ln; }
    else if (/^2\b/.test(nm) && !away) { away = v; }
  }
  if (line != null && home && away) {
    odds[`hcp_home_${line}`] = home;
    odds[`hcp_away_${-line}`] = away;
  }
}

// Odd/Even
function putOddEven(odds, market, pfx) {
  const outs = market.outcomes || [];
  const oddV = findByName(outs, 'Impair', 'Odd');
  const evenV = findByName(outs, 'Pair', 'Even');
  if (oddV) odds[`${pfx}odd`] = oddV;
  if (evenV) odds[`${pfx}even`] = evenV;
}

export function premierbetFlatOdds(markets) {
  const odds = {};
  for (const m of (markets || [])) {
    if (!m || !Array.isArray(m.outcomes)) continue;
    const id = Number(m.id);
    switch (id) {
      // MATCH FULL TIME
      case 3: put1x2(odds, m, ''); break;
      case 17: putDC(odds, m, ''); break;
      case 7: putBtts(odds, m, ''); break;
      case 29: putTotal(odds, m, 'match_'); break;
      case 87: putAsianHcp(odds, m); break;
      case 44: putDnb(odds, m, ''); break;
      case 353: putTeamTotal(odds, m, 'home', ''); break;
      case 352: putTeamTotal(odds, m, 'away', ''); break;
      case 386: putOddEven(odds, m, ''); break;

      // 1ère MI-TEMPS
      case 6: put1x2(odds, m, 'ht_'); break;
      case 155: putDC(odds, m, 'ht_'); break;
      case 119: putBtts(odds, m, 'ht_'); break;
      case 45: putTotal(odds, m, 'ht_'); break;

      // 2ème MI-TEMPS
      case 96: put1x2(odds, m, 'h2_'); break;
      case 156: putDC(odds, m, 'h2_'); break;
      case 120: putBtts(odds, m, 'h2_'); break;
      case 97: putTotal(odds, m, 'h2_'); break;

      default: break;
    }
    // Fallback par name pour couvrir les markets non-mappés (evolution API)
    const nameLower = String(m.name || '').toLowerCase();
    if (id !== 3 && /^1x2\b|^résultat.*match/.test(nameLower)) put1x2(odds, m, '');
    else if (id !== 17 && /double chance|chance double/.test(nameLower) && !nameLower.includes('mi-temps') && !nameLower.includes('half')) putDC(odds, m, '');
    else if (id !== 7 && /les deux .* marquent|both teams to score|btts/.test(nameLower) && !nameLower.includes('mi-temps')) putBtts(odds, m, '');
    else if (id !== 29 && /^total.*buts|over.?under/.test(nameLower) && !nameLower.includes('mi-temps') && !nameLower.includes('half') && !nameLower.includes('équipe')) putTotal(odds, m, 'match_');
  }
  return odds;
}
