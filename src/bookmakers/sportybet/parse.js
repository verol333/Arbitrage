// Parseur football SportyBet — mapping par MARKET ID (déterministe).
// Structure : match.markets[].{id, name, specifier, outcomes[].desc/odds}
import { isHalfLine } from '../../core/markets.js';

// SportyBet market IDs (source doc /pcUpcomingEvents) :
//   1     = 1X2                     (desc: Home / Draw / Away)
//   18    = Total Over/Under        (specifier: "total=2.5", desc: "Over 2.5"/"Under 2.5")
//   10    = Double Chance           (desc: "Home or Draw"/"Home or Away"/"Away or Draw")
//   29    = Both Teams To Score     (desc: Yes/No)
//   11    = Draw No Bet             (desc: Home/Away)
//   26    = Odd/Even Total          (desc: Odd/Even)
//   14    = Asian Handicap          (specifier: "hcp=-1.5", desc: "Home (-1.5)"/"Away (+1.5)")
//   60100 = 1MT 1X2                 (desc: Home/Draw/Away)
// Autres IDs découverts au fil du fetch /event?eventId=... sont ignorés.

export function sportybetFlatOdds(markets) {
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

      // ─── Asian Handicap (ligne dans specifier "hcp=X.X") ─────────
      case '14': putAsianHcp(odds, m, ''); break;

      // ─── 1MT 1X2 ──────────────────────────────────────────────────
      case '60100': {
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

      default: break;  // Autres marchés ignorés (combos, spécifiques, etc.)
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
