// Parseur football SportyBet — mapping par MARKET ID (déterministe).
// Structure : match.markets[].{id, name, specifier, outcomes[].desc/odds}
// IDs vérifiés via F12 sur /api/ng/factsCenter/event?eventId=...&productId=3.
import { isHalfLine } from '../../core/markets.js';

// SportyBet market IDs (FullTime) :
//   1  = 1X2                     (desc: Home / Draw / Away)
//   18 = Total Over/Under        (specifier: "total=X.X", desc: "Over X.X" / "Under X.X")
//   10 = Double Chance           (desc: "Home or Draw" / "Home or Away" / "Away or Draw")
//   29 = GG/NG                   (desc: Yes / No)
//   11 = Draw No Bet             (desc: Home / Away)
//   26 = Odd/Even Total          (desc: Odd / Even)
//   16 = Asian Handicap          (specifier: "hcp=-0.5", desc: "Home (-0.5)" / "Away (+0.5)")
//
// 1st Half :
//   60 = 1st Half - 1X2          (desc: Home / Draw / Away)
//   68 = 1st Half - Over/Under   (specifier: "total=X.X")
//
// ⚠️ NE PAS mapper 60100, 60200, 60210 : variantes "2UP / 1UP / Never Down" (Early Payout)
// dont les cotes divergent du 1X2 standard → produisent des fake arbs.
// ⚠️ NE PAS mapper 14 : Handicap score-based (specifier "hcp=0:1"), pas un Asian HCP.

export function sportybetFlatOdds(markets, { live = false } = {}) {
  const odds = {};
  if (!Array.isArray(markets)) return odds;

  for (const m of markets) {
    const id = String(m?.id ?? '');
    const outcomes = Array.isArray(m?.outcomes) ? m.outcomes : [];
    if (!outcomes.length) continue;

    switch (id) {
      // ─── 1X2 fulltime ─────────────────────────────────────────────
      case '1': {
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          if (d === 'home' || d === '1') odds.match_1 = v;
          else if (d === 'draw' || d === 'x') odds.match_X = v;
          else if (d === 'away' || d === '2') odds.match_2 = v;
        }
        break;
      }

      // ─── Total Over/Under (ligne dans specifier "total=X.X") ─────
      case '18': putTotal(odds, m, 'match_'); break;

      // ─── Double Chance ────────────────────────────────────────────
      case '10': {
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          if (d === 'home or draw' || d === '1x') odds.dc_1X = v;
          else if (d === 'home or away' || d === '12') odds.dc_12 = v;
          else if (d === 'away or draw' || d === 'x2') odds.dc_X2 = v;
        }
        break;
      }

      // ─── BTTS ─────────────────────────────────────────────────────
      case '29': {
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          if (d === 'yes' || d === 'oui') odds.btts_yes = v;
          else if (d === 'no' || d === 'non') odds.btts_no = v;
        }
        break;
      }

      // ─── Draw No Bet ──────────────────────────────────────────────
      case '11': {
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          if (d === 'home' || d === '1') odds.dnb_1 = v;
          else if (d === 'away' || d === '2') odds.dnb_2 = v;
        }
        break;
      }

      // ─── Odd/Even Total ───────────────────────────────────────────
      case '26': {
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          if (d === 'odd' || d === 'impair') odds.odd = v;
          else if (d === 'even' || d === 'pair') odds.even = v;
        }
        break;
      }

      // ─── Asian Handicap FT (specifier "hcp=X.X") ─────────────────
      case '16': putAsianHcp(odds, m, ''); break;

      // ─── 1MT 1X2 (vrai ID = 60, pas 60100 qui est une variante 2UP) ──
      case '60': {
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          if (d === 'home' || d === '1') odds.ht_match_1 = v;
          else if (d === 'draw' || d === 'x') odds.ht_match_X = v;
          else if (d === 'away' || d === '2') odds.ht_match_2 = v;
        }
        break;
      }

      // ─── 1MT Over/Under (specifier "total=X.X") ──────────────────
      case '68': putTotal(odds, m, 'ht_'); break;

      default: break;  // Autres marchés ignorés (combos, spécifiques, variantes Early Payout).
    }
  }
  return odds;
}

// Total O/U : ligne extraite du specifier "total=X.X".
function putTotal(odds, m, pfx) {
  const line = extractLine(m.specifier, 'total');
  if (!isHalfLine(line)) return;
  for (const o of m.outcomes || []) {
    const v = Number(o?.odds);
    if (!Number.isFinite(v) || v <= 1) continue;
    const d = String(o?.desc || '').toLowerCase();
    if (/^over/.test(d) || /plus/.test(d)) odds[`${pfx}over_${line}`] = v;
    else if (/^under/.test(d) || /moins/.test(d)) odds[`${pfx}under_${line}`] = v;
  }
}

// Handicap Asian : specifier "hcp=X.X" (signé). Home prend ligne l, Away prend -l.
function putAsianHcp(odds, m, pfx) {
  const line = extractLine(m.specifier, 'hcp');
  if (line == null || !isHalfLine(Math.abs(line))) return;
  for (const o of m.outcomes || []) {
    const v = Number(o?.odds);
    if (!Number.isFinite(v) || v <= 1) continue;
    const d = String(o?.desc || '').toLowerCase();
    if (/home|\b1\b/.test(d)) odds[`${pfx}hcp_home_${line}`] = v;
    else if (/away|\b2\b/.test(d)) odds[`${pfx}hcp_away_${-line}`] = v;
  }
}

// Extrait la valeur numérique après "key=" dans "specifier" ex: "total=2.5" → 2.5.
function extractLine(specifier, key) {
  if (!specifier) return null;
  const m = String(specifier).match(new RegExp(`${key}=(-?\\d+(?:\\.\\d+)?)`));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
