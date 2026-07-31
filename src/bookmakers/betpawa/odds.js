// Lecture des cotes BetPawa — mappe la sortie JSON du Worker vers les clés
// standard du système (match_1, match_over_2.5, btts_yes, etc.).
// Les marchés arrivent inline depuis le listing (pas de call detail séparé) ;
// le Worker parse le protobuf et retourne un objet `markets` par match.
import { isHalfLine } from '../../core/markets.js';

export function betpawaFlatOdds(markets) {
  if (!markets || typeof markets !== 'object') return {};
  const odds = {};

  // 1X2 Full Time — markets['1x2'] = [home, draw, away]
  if (Array.isArray(markets['1x2']) && markets['1x2'].length === 3) {
    const [h, d, a] = markets['1x2'];
    if (valid(h)) odds.match_1 = h;
    if (valid(d)) odds.match_X = d;
    if (valid(a)) odds.match_2 = a;
  }

  // Over/Under — markets['ou_2.5'] = [over, under]
  for (const [key, val] of Object.entries(markets)) {
    if (!key.startsWith('ou_') || !Array.isArray(val) || val.length < 2) continue;
    const line = parseFloat(key.slice(3));
    if (!isHalfLine(line)) continue;
    const [over, under] = val;
    if (valid(over)) odds[`match_over_${line}`] = over;
    if (valid(under)) odds[`match_under_${line}`] = under;
  }

  // BTTS — markets['btts'] = [yes, no]
  if (Array.isArray(markets['btts']) && markets['btts'].length === 2) {
    const [yes, no] = markets['btts'];
    if (valid(yes)) odds.btts_yes = yes;
    if (valid(no)) odds.btts_no = no;
  }

  // Double Chance — markets['dc'] = [1X, 12, X2]
  if (Array.isArray(markets['dc']) && markets['dc'].length === 3) {
    const [dc1X, dc12, dcX2] = markets['dc'];
    if (valid(dc1X)) odds.dc_1X = dc1X;
    if (valid(dc12)) odds.dc_12 = dc12;
    if (valid(dcX2)) odds.dc_X2 = dcX2;
  }

  // Draw No Bet — markets['dnb'] = [home, away]
  if (Array.isArray(markets['dnb']) && markets['dnb'].length === 2) {
    const [h, a] = markets['dnb'];
    if (valid(h)) odds.dnb_1 = h;
    if (valid(a)) odds.dnb_2 = a;
  }

  // Handicap — markets['hcp_-1.5'] = [home, away]
  for (const [key, val] of Object.entries(markets)) {
    if (!key.startsWith('hcp_') || !Array.isArray(val) || val.length < 2) continue;
    const line = parseFloat(key.slice(4));
    if (!isHalfLine(line)) continue;
    const [h, a] = val;
    if (valid(h)) odds[`hcp_home_${line}`] = h;
    if (valid(a)) odds[`hcp_away_${-line}`] = a;
  }

  // Odd/Even — markets['oe'] = [odd, even]
  if (Array.isArray(markets['oe']) && markets['oe'].length === 2) {
    const [o, e] = markets['oe'];
    if (valid(o)) odds.odd = o;
    if (valid(e)) odds.even = e;
  }

  return odds;
}

function valid(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 1 && v <= 80;
}

export function getOdds(match) {
  const inline = match?.__raw?.markets;
  if (inline && Object.keys(inline).length) {
    return betpawaFlatOdds(inline);
  }
  return {};
}
