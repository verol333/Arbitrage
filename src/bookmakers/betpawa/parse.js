// BetPawa parser : mapping par MARKET ID (déterministe, comme PremierBet).
// Structure API : event.markets[].marketType.id + market.row[].prices[]
// Chaque price a name/displayName + odds (float direct).
//
// Market IDs BetPawa découverts via probe-betpawa-markets.js :
//   3743   = 1X2 - FT              (outcomes: 1/X/2)
//   4693   = Double Chance - FT    (outcomes: 1X/12/X2)
//   3795   = BTTS - FT             (outcomes: Oui/Non)
//   4703   = DNB - FT              (outcomes: 1/2)
//   5000   = Total Score O/U - FT  (outcomes: Plus de X.X / Moins de X.X)
//   5006   = Team Total - Home     (outcomes: Plus de X.X / Moins de X.X)
//   5003   = Team Total - Away
//   4833   = Odd/Even - FT         (outcomes: Impair/Pair)
//   3668   = 1X2 - 1H
//   4673   = DC - 1H
//   3789   = BTTS - 1H
//   4697   = DNB - 1H
//   4958   = Total O/U - 1H
//   4794   = Odd/Even - 1H
//   3685   = 1X2 - 2H
//   4681   = DC - 2H
//   3792   = BTTS - 2H
//   4700   = DNB - 2H
//   4976   = Total O/U - 2H
//   4809   = Odd/Even - 2H
//   4728   = Half More Goals - Total (3 outcomes: 1ère/2ème/Égalité)
//   28000810/850 = 1UP/2UP variants (cashout anticipé, PAS équivalent 1X2 → ignorés)
//   4724/4716/4720 = Handicap 1X2 (3-way European, ignoré)
//   3774   = Asian Handicap - FT (à évaluer : nécessite parsing ligne dans row)
//   Multi-outcomes complexes (Correct Score, HT/FT, DC+BTTS combo, Multigoals,
//   Winning Margin, Clean Sheet, Team-specific, etc.) ignorés.
import { isHalfLine } from '../../core/markets.js';

export function betpawaFlatOdds(eventJson) {
  const odds = {};
  if (!eventJson?.markets?.length) return odds;

  for (const market of eventJson.markets) {
    const marketId = String(market?.marketType?.id ?? '');
    const prices = flattenPrices(market.row);
    if (!prices.length) continue;

    switch (marketId) {
      // ─── FT ────────────────────────────────────────────────────────
      case '3743': put1x2(odds, prices, ''); break;
      case '4693': putDC(odds, prices, ''); break;
      case '3795': putBTTS(odds, prices, ''); break;
      case '4703': putDNB(odds, prices, ''); break;
      case '5000': putTotal(odds, prices, 'match_'); break;
      case '5006': putTeamTotal(odds, prices, 'home', ''); break;
      case '5003': putTeamTotal(odds, prices, 'away', ''); break;
      case '4833': putOddEven(odds, prices, ''); break;

      // ─── 1ère mi-temps ─────────────────────────────────────────────
      case '3668': put1x2(odds, prices, 'ht_'); break;
      case '4673': putDC(odds, prices, 'ht_'); break;
      case '3789': putBTTS(odds, prices, 'ht_'); break;
      case '4697': putDNB(odds, prices, 'ht_'); break;
      case '4958': putTotal(odds, prices, 'ht_'); break;
      case '4794': putOddEven(odds, prices, 'ht_'); break;

      // ─── 2ème mi-temps ─────────────────────────────────────────────
      case '3685': put1x2(odds, prices, 'h2_'); break;
      case '4681': putDC(odds, prices, 'h2_'); break;
      case '3792': putBTTS(odds, prices, 'h2_'); break;
      case '4700': putDNB(odds, prices, 'h2_'); break;
      case '4976': putTotal(odds, prices, 'h2_'); break;
      case '4809': putOddEven(odds, prices, 'h2_'); break;

      // ─── Mi-temps la plus prolifique ───────────────────────────────
      case '4728': putHighestScoringHalf(odds, prices); break;

      // ─── IGNORÉS explicitement ─────────────────────────────────────
      // Variantes 1UP/2UP (cashout anticipé, non équivalent 1X2 standard)
      // Handicap 3-way European (non comparable au 2-way asiatique)
      // Marchés complexes (correct score, combos, multigoals, ht/ft, etc.)
      default: break;
    }
  }
  return odds;
}

// ─── Helpers de parsing ───────────────────────────────────────────────
function put1x2(odds, prices, pfx) {
  const p = byLabel(prices);
  if (p['1']) odds[`${pfx}match_1`] = p['1'];
  if (p['X'] || p['x']) odds[`${pfx}match_X`] = p['X'] || p['x'];
  if (p['2']) odds[`${pfx}match_2`] = p['2'];
}
function putDC(odds, prices, pfx) {
  const p = byLabel(prices);
  if (p['1X'] || p['1x']) odds[`${pfx}dc_1X`] = p['1X'] || p['1x'];
  if (p['12']) odds[`${pfx}dc_12`] = p['12'];
  if (p['X2'] || p['x2']) odds[`${pfx}dc_X2`] = p['X2'] || p['x2'];
}
function putBTTS(odds, prices, pfx) {
  const p = byLabel(prices);
  const yes = p['Oui'] || p['Yes'] || p['oui'] || p['yes'];
  const no = p['Non'] || p['No'] || p['non'] || p['no'];
  if (yes) odds[`${pfx}btts_yes`] = yes;
  if (no) odds[`${pfx}btts_no`] = no;
}
function putDNB(odds, prices, pfx) {
  const p = byLabel(prices);
  if (p['1']) odds[`${pfx}dnb_1`] = p['1'];
  if (p['2']) odds[`${pfx}dnb_2`] = p['2'];
}
function putOddEven(odds, prices, pfx) {
  const p = byLabel(prices);
  const odd = p['Impair'] || p['Odd'] || p['impair'] || p['odd'];
  const even = p['Pair'] || p['Even'] || p['pair'] || p['even'];
  if (odd) odds[`${pfx}odd`] = odd;
  if (even) odds[`${pfx}even`] = even;
}
// Total O/U multi-lignes : labels 'Plus de X.X' ou 'Moins de X.X'.
function putTotal(odds, prices, pfx) {
  for (const p of prices) {
    const label = String(p?.name || p?.displayName || '').trim();
    const v = Number(p?.odds);
    if (!Number.isFinite(v) || v <= 1) continue;
    const m = label.match(/(plus\s*de|over|moins\s*de|under)\s*([\d.]+)/i);
    if (!m) continue;
    const line = Number(m[2]);
    if (!isHalfLine(line)) continue;
    const dir = /plus|over/i.test(m[1]) ? 'over' : 'under';
    odds[`${pfx}${dir}_${line}`] = v;
  }
}
function putTeamTotal(odds, prices, side, pfx) {
  for (const p of prices) {
    const label = String(p?.name || p?.displayName || '').trim();
    const v = Number(p?.odds);
    if (!Number.isFinite(v) || v <= 1) continue;
    const m = label.match(/(plus\s*de|over|moins\s*de|under)\s*([\d.]+)/i);
    if (!m) continue;
    const line = Number(m[2]);
    if (!isHalfLine(line)) continue;
    const dir = /plus|over/i.test(m[1]) ? 'over' : 'under';
    odds[`${pfx}tt_${side}_${dir}_${line}`] = v;
  }
}
function putHighestScoringHalf(odds, prices) {
  const p = byLabel(prices);
  const ht = p['Première Mi-Temps'] || p['Premiere Mi-Temps'] || p['1ère'] || p['1st Half'];
  const h2 = p['Deuxième Mi-Temps'] || p['Deuxieme Mi-Temps'] || p['2ème'] || p['2nd Half'];
  const eq = p['Égalité'] || p['Egalité'] || p['Egalite'] || p['Draw'];
  if (ht) odds.half_most_ht = ht;
  if (h2) odds.half_most_h2 = h2;
  if (eq) odds.half_most_equal = eq;
}

// ─── Utilitaires ──────────────────────────────────────────────────────
function flattenPrices(row) {
  const out = [];
  if (!Array.isArray(row)) return out;
  for (const r of row) {
    if (!Array.isArray(r?.prices)) continue;
    for (const p of r.prices) out.push(p);
  }
  return out;
}
function byLabel(prices) {
  const map = {};
  for (const p of prices) {
    const label = String(p?.name || p?.displayName || '').trim();
    const v = Number(p?.odds);
    if (label && Number.isFinite(v) && v > 1) map[label] = v;
  }
  return map;
}
