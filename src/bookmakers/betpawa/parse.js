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

// Parseur tennis BetPawa. Marches identifies via probe-bp-tennis-markets :
//   2043818 = Moneyline - FT              (name 1/2 → match_1/2)
//   4758    = Moneyline - 1S              → s1_match_1/2
//   4770    = Moneyline - 2S              → s2_match_1/2
//   3532590 = Match Handicap Games 2-way  (specifier.hcp, name 1=home/2=away)
//   4666923 = Set 1 Game Handicap         (specifier.hcp, name Domicile/Extérieur)
//   4895    = Total Games O/U - FT        (specifier.total, name Plus de/Moins de)
//   4880    = Total Games O/U - 1S        → s1_over/under_X
//   2068161 = Games O/U Home - FT         → tt_home_over/under_X
//   2068172 = Games O/U Away - FT         → tt_away_over/under_X
//   3597899 = Total Sets O/U - FT         → total_sets_over/under_X
//   4429    = Correct Score               (skip, pas standard cross-book)
export function betpawaTennisFlatOdds(eventJson) {
  const odds = {};
  if (!eventJson?.markets?.length) return odds;
  for (const market of eventJson.markets) {
    const marketId = String(market?.marketType?.id ?? '');
    const rows = market.row || [];
    if (!rows.length) continue;

    // Iterer sur chaque row (chaque row = 1 ligne handicap/total, avec ses prices)
    for (const row of rows) {
      const spec = row?.specifier || {};
      const hcpStr = spec.hcp;
      const totalStr = spec.total;
      for (const p of (row.prices || [])) {
        const name = String(p?.name || '').trim();
        const v = Number(p?.odds);
        if (!Number.isFinite(v) || v <= 1) continue;

        switch (marketId) {
          // Moneyline FT/1S/2S : name "1" = home, "2" = away
          case '2043818': // Match Winner FT
            if (name === '1') odds.match_1 = v;
            else if (name === '2') odds.match_2 = v;
            break;
          case '4758': // 1S
            if (name === '1') odds.s1_match_1 = v;
            else if (name === '2') odds.s1_match_2 = v;
            break;
          case '4770': // 2S
            if (name === '1') odds.s2_match_1 = v;
            else if (name === '2') odds.s2_match_2 = v;
            break;

          // Handicap match : specifier.hcp = valeur pour home (name=1)
          // name "2" = away avec le hcp inverse
          case '3532590': { // Match Handicap Games 2-way
            const hcp = Number(hcpStr);
            if (!Number.isFinite(hcp) || !isHalfLine(hcp)) break;
            if (name === '1') odds[`hcp_home_${hcp}`] = v;
            else if (name === '2') odds[`hcp_away_${-hcp}`] = v;
            break;
          }
          // Handicap 1S : name = "Domicile"/"Extérieur"
          case '4666923': { // Set 1 Game Handicap
            const hcp = Number(hcpStr);
            if (!Number.isFinite(hcp) || !isHalfLine(hcp)) break;
            if (/dom/i.test(name)) odds[`s1_hcp_home_${hcp}`] = v;
            else if (/ext/i.test(name)) odds[`s1_hcp_away_${-hcp}`] = v;
            break;
          }

          // Total games FT : "Plus de"/"Moins de" + specifier.total
          case '4895': { // Total Games O/U FT
            const line = Number(totalStr);
            if (!Number.isFinite(line) || !isHalfLine(line)) break;
            if (/plus/i.test(name)) odds[`match_over_${line}`] = v;
            else if (/moins/i.test(name)) odds[`match_under_${line}`] = v;
            break;
          }
          case '4880': { // Total Games O/U 1S
            const line = Number(totalStr);
            if (!Number.isFinite(line) || !isHalfLine(line)) break;
            if (/plus/i.test(name)) odds[`s1_over_${line}`] = v;
            else if (/moins/i.test(name)) odds[`s1_under_${line}`] = v;
            break;
          }

          // Team totals (Games par joueur)
          case '2068161': { // Home total games
            const line = Number(totalStr);
            if (!Number.isFinite(line) || !isHalfLine(line)) break;
            if (/plus/i.test(name)) odds[`tt_home_over_${line}`] = v;
            else if (/moins/i.test(name)) odds[`tt_home_under_${line}`] = v;
            break;
          }
          case '2068172': { // Away total games
            const line = Number(totalStr);
            if (!Number.isFinite(line) || !isHalfLine(line)) break;
            if (/plus/i.test(name)) odds[`tt_away_over_${line}`] = v;
            else if (/moins/i.test(name)) odds[`tt_away_under_${line}`] = v;
            break;
          }

          // Total sets FT
          case '3597899': { // Total Sets O/U FT
            const line = Number(totalStr);
            if (!Number.isFinite(line) || !isHalfLine(line)) break;
            if (/plus/i.test(name)) odds[`total_sets_over_${line}`] = v;
            else if (/moins/i.test(name)) odds[`total_sets_under_${line}`] = v;
            break;
          }
          default: break;
        }
      }
    }
  }
  return odds;
}

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
