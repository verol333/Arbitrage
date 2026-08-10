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

// Helper : ecrit odds[key] = v ET odds._ids[key] = { marketId, outcomeId,
// specifier } pour permettre au backend de generer un code coupon (endpoint
// SportyBet /api/ng/orders/share, format attendu :
// [{ eventId, marketId, outcomeId, specifier? }]). `eventId` est injecte par
// collect.js depuis match.id ("sr:match:X"). Le parseur produit les IDs
// spec/market/outcome natifs SR API — voir docs/coupon-codes-research.md.
function putSb(odds, key, v, m, o) {
  odds[key] = v;
  if (!odds._ids) odds._ids = {};
  odds._ids[key] = {
    marketId: String(m?.id ?? ''),
    outcomeId: o?.id != null ? String(o.id) : (o?.desc ?? null),
    specifier: m?.specifier || null,
  };
}

export function sportybetFlatOdds(markets, { live = false, sport = 'football' } = {}) {
  if (sport === 'tennis') return sportybetTennisFlatOdds(markets);
  if (sport === 'basket') return sportybetBasketFlatOdds(markets);
  if (sport === 'hockey') return sportybetHockeyFlatOdds(markets);
  const odds = { _ids: {} };
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
          if (d === 'home' || d === '1') putSb(odds, 'match_1', v, m, o);
          else if (d === 'draw' || d === 'x') putSb(odds, 'match_X', v, m, o);
          else if (d === 'away' || d === '2') putSb(odds, 'match_2', v, m, o);
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
          if (d === 'home or draw' || d === '1x') putSb(odds, 'dc_1X', v, m, o);
          else if (d === 'home or away' || d === '12') putSb(odds, 'dc_12', v, m, o);
          else if (d === 'away or draw' || d === 'x2') putSb(odds, 'dc_X2', v, m, o);
        }
        break;
      }

      // ─── BTTS ─────────────────────────────────────────────────────
      case '29': {
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          if (d === 'yes' || d === 'oui') putSb(odds, 'btts_yes', v, m, o);
          else if (d === 'no' || d === 'non') putSb(odds, 'btts_no', v, m, o);
        }
        break;
      }

      // ─── Draw No Bet ──────────────────────────────────────────────
      case '11': {
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          if (d === 'home' || d === '1') putSb(odds, 'dnb_1', v, m, o);
          else if (d === 'away' || d === '2') putSb(odds, 'dnb_2', v, m, o);
        }
        break;
      }

      // ─── Odd/Even Total ───────────────────────────────────────────
      case '26': {
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          if (d === 'odd' || d === 'impair') putSb(odds, 'odd', v, m, o);
          else if (d === 'even' || d === 'pair') putSb(odds, 'even', v, m, o);
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
          if (d === 'home' || d === '1') putSb(odds, 'ht_match_1', v, m, o);
          else if (d === 'draw' || d === 'x') putSb(odds, 'ht_match_X', v, m, o);
          else if (d === 'away' || d === '2') putSb(odds, 'ht_match_2', v, m, o);
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
    if (/^over/.test(d) || /plus/.test(d)) putSb(odds, `${pfx}over_${line}`, v, m, o);
    else if (/^under/.test(d) || /moins/.test(d)) putSb(odds, `${pfx}under_${line}`, v, m, o);
  }
}

// Handicap Asian : specifier "hcp=X.X" (signé). Home prend ligne l, Away prend -l.
// BUG CRITIQUE FIX : les regex /home|\b1\b/ et /away|\b2\b/ matchaient le "1" ou
// "2" dans les nombres du desc (ex: "Away (+1.5)" contient "1" → \b1\b match).
// Résultat : cote Away ÉCRASAIT cote Home sur hcp_home_${line}, produisant des
// fake arbs handicap systématiques (user report : Sagarejo +1.5 @ 5.40 = fake).
// Fix : extraction du team key (mot avant parenthèse) et match exact.
function putAsianHcp(odds, m, pfx) {
  const line = extractLine(m.specifier, 'hcp');
  if (line == null || !isHalfLine(Math.abs(line))) return;
  for (const o of m.outcomes || []) {
    const v = Number(o?.odds);
    if (!Number.isFinite(v) || v <= 1) continue;
    const d = String(o?.desc || '').toLowerCase();
    // Extraire uniquement la partie AVANT la parenthèse ou espace
    const teamKey = d.split(/[\s(]/)[0].trim();
    if (teamKey === 'home' || teamKey === '1') putSb(odds, `${pfx}hcp_home_${line}`, v, m, o);
    else if (teamKey === 'away' || teamKey === '2') putSb(odds, `${pfx}hcp_away_${-line}`, v, m, o);
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

// ═══════════════════════════════════════════════════════════════
// PARSEUR BASKET SportyBet (SportRadar UOF, incl. OT).
// Market IDs validés via probe-basket-dump v2 (sr:sport:2) sur WNBA :
//   219 = Winner incl OT           (desc "Home"/"Away")
//   225 = Total incl OT            (spec.total, desc "Over X"/"Under X")
//   223 = Asian Handicap incl OT   (spec.hcp, desc "Home (-X)"/"Away (+X)")
//   227 = Home TT incl OT          (spec.total)
//   228 = Away TT incl OT          (spec.total)
//   229 = Odd/Even incl OT         (desc "Odd"/"Even")
//   60  = 1H 1X2                   → h1_match_1/X/2
//   68  = 1H Total                 → h1_over/under (spec.total)
//   66  = 1H Asian Handicap        → h1_hcp_home/away (spec.hcp)
//   83  = 2H 1X2                   → h2_match_1/X/2
//   235 = Q1-Q4 1X2                (spec.quarternr) → q{n}_match_1/X/2
//   303 = Q1-Q4 Asian Handicap     (spec.quarternr+hcp) → q{n}_hcp_home/away
//   236 = Q1-Q4 Total              (spec.quarternr+total) → q{n}_over/under
//   304 = Q1-Q4 Odd/Even           (spec.quarternr) → q{n}_odd/even
// ATTENTION: id=18 (Total sans OT) et id=1 (1X2 sans OT) SKIPPÉS pour éviter
// mix incl-OT vs reg-time qui produirait faux surbètes.
// ═══════════════════════════════════════════════════════════════
function sportybetBasketFlatOdds(markets) {
  const odds = { _ids: {} };
  if (!Array.isArray(markets)) return odds;

  for (const m of markets) {
    const id = String(m?.id ?? '');
    const spec = String(m.specifier || '');
    const outcomes = Array.isArray(m?.outcomes) ? m.outcomes : [];
    if (!outcomes.length) continue;
    const total = extractLine(spec, 'total');
    const hcp = extractLine(spec, 'hcp');
    const qn = extractLine(spec, 'quarternr');
    const qPfx = qn ? `q${qn}_` : '';

    switch (id) {
      // ─── FT (incl OT) ─────────────────────────────────────────────
      case '219': { // Winner incl OT
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase().trim();
          if (d === 'home' || d === '1') putSb(odds, 'match_1', v, m, o);
          else if (d === 'away' || d === '2') putSb(odds, 'match_2', v, m, o);
        }
        break;
      }
      case '225': { // Total FT
        if (total == null || !isHalfLine(total)) break;
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          if (/^over/.test(d)) putSb(odds, `match_over_${total}`, v, m, o);
          else if (/^under/.test(d)) putSb(odds, `match_under_${total}`, v, m, o);
        }
        break;
      }
      case '223': { // Handicap FT (incl OT)
        if (hcp == null || !isHalfLine(Math.abs(hcp))) break;
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          const teamKey = d.split(/[\s(]/)[0].trim();
          if (teamKey === 'home' || teamKey === '1') putSb(odds, `hcp_home_${hcp}`, v, m, o);
          else if (teamKey === 'away' || teamKey === '2') putSb(odds, `hcp_away_${-hcp}`, v, m, o);
        }
        break;
      }
      case '227': { // Home TT FT
        if (total == null || !isHalfLine(total)) break;
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          if (/^over/.test(d)) putSb(odds, `tt_home_over_${total}`, v, m, o);
          else if (/^under/.test(d)) putSb(odds, `tt_home_under_${total}`, v, m, o);
        }
        break;
      }
      case '228': { // Away TT FT
        if (total == null || !isHalfLine(total)) break;
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          if (/^over/.test(d)) putSb(odds, `tt_away_over_${total}`, v, m, o);
          else if (/^under/.test(d)) putSb(odds, `tt_away_under_${total}`, v, m, o);
        }
        break;
      }
      case '229': { // O/E FT
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          if (d === 'odd') putSb(odds, 'odd', v, m, o);
          else if (d === 'even') putSb(odds, 'even', v, m, o);
        }
        break;
      }

      // ─── Halves ────────────────────────────────────────────────────
      case '60': { // 1H 1X2 (3-way)
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          if (d === 'home' || d === '1') putSb(odds, 'h1_match_1', v, m, o);
          else if (d === 'draw' || d === 'x') putSb(odds, 'h1_match_X', v, m, o);
          else if (d === 'away' || d === '2') putSb(odds, 'h1_match_2', v, m, o);
        }
        break;
      }
      case '83': { // 2H 1X2
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          if (d === 'home' || d === '1') putSb(odds, 'h2_match_1', v, m, o);
          else if (d === 'draw' || d === 'x') putSb(odds, 'h2_match_X', v, m, o);
          else if (d === 'away' || d === '2') putSb(odds, 'h2_match_2', v, m, o);
        }
        break;
      }
      case '68': { // 1H Total
        if (total == null || !isHalfLine(total)) break;
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          if (/^over/.test(d)) putSb(odds, `h1_over_${total}`, v, m, o);
          else if (/^under/.test(d)) putSb(odds, `h1_under_${total}`, v, m, o);
        }
        break;
      }
      case '66': { // 1H Asian Handicap
        if (hcp == null || !isHalfLine(Math.abs(hcp))) break;
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          const teamKey = d.split(/[\s(]/)[0].trim();
          if (teamKey === 'home' || teamKey === '1') putSb(odds, `h1_hcp_home_${hcp}`, v, m, o);
          else if (teamKey === 'away' || teamKey === '2') putSb(odds, `h1_hcp_away_${-hcp}`, v, m, o);
        }
        break;
      }

      // ─── Quarters (quarternr in spec) ─────────────────────────────
      case '235': { // Q{n} 1X2
        if (!qPfx) break;
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          if (d === 'home' || d === '1') putSb(odds, `${qPfx}match_1`, v, m, o);
          else if (d === 'draw' || d === 'x') putSb(odds, `${qPfx}match_X`, v, m, o);
          else if (d === 'away' || d === '2') putSb(odds, `${qPfx}match_2`, v, m, o);
        }
        break;
      }
      case '236': { // Q{n} Total
        if (!qPfx || total == null || !isHalfLine(total)) break;
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          if (/^over/.test(d)) putSb(odds, `${qPfx}over_${total}`, v, m, o);
          else if (/^under/.test(d)) putSb(odds, `${qPfx}under_${total}`, v, m, o);
        }
        break;
      }
      case '303': { // Q{n} Handicap
        if (!qPfx || hcp == null || !isHalfLine(Math.abs(hcp))) break;
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          const teamKey = d.split(/[\s(]/)[0].trim();
          if (teamKey === 'home' || teamKey === '1') putSb(odds, `${qPfx}hcp_home_${hcp}`, v, m, o);
          else if (teamKey === 'away' || teamKey === '2') putSb(odds, `${qPfx}hcp_away_${-hcp}`, v, m, o);
        }
        break;
      }
      case '304': { // Q{n} Odd/Even
        if (!qPfx) break;
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          if (d === 'odd') putSb(odds, `${qPfx}odd`, v, m, o);
          else if (d === 'even') putSb(odds, `${qPfx}even`, v, m, o);
        }
        break;
      }
      default: break;
    }
  }
  return odds;
}

// ═══════════════════════════════════════════════════════════════
// PARSEUR HOCKEY SportyBet (SportRadar UOF sr:sport:4).
// UOF market IDs cross-sport safe : 1=1X2 (Home/Draw/Away regulation),
// 10=DC, 18=Total (spec.total), 16=Asian Hcp (spec.hcp), 26=Odd/Even, 29=BTTS.
// Convention hockey : winner en reg-time est 3-way (draw apres 60min possible).
// V1 conservateur : winner + total + hcp + O/E. Extension periodes P1/P2/P3 TODO.
// ═══════════════════════════════════════════════════════════════
function sportybetHockeyFlatOdds(markets) {
  const odds = { _ids: {} };
  if (!Array.isArray(markets)) return odds;
  for (const m of markets) {
    const id = String(m?.id || '');
    const outcomes = Array.isArray(m?.outcomes) ? m.outcomes : [];
    if (!outcomes.length) continue;
    switch (id) {
      case '1': {
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          if (d === 'home' || d === '1') putSb(odds, 'match_1', v, m, o);
          else if (d === 'draw' || d === 'x') putSb(odds, 'match_X', v, m, o);
          else if (d === 'away' || d === '2') putSb(odds, 'match_2', v, m, o);
        }
        break;
      }
      case '18': putTotal(odds, m, 'match_'); break;
      case '16': putAsianHcp(odds, m, ''); break;
      case '26': {
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          if (/^odd|impair/.test(d)) putSb(odds, 'odd', v, m, o);
          else if (/^even|pair/.test(d)) putSb(odds, 'even', v, m, o);
        }
        break;
      }
      case '10': {
        for (const o of outcomes) {
          const v = Number(o?.odds);
          if (!Number.isFinite(v) || v <= 1) continue;
          const d = String(o?.desc || '').toLowerCase();
          if (d === 'home or draw' || d === '1x') putSb(odds, 'dc_1X', v, m, o);
          else if (d === 'home or away' || d === '12') putSb(odds, 'dc_12', v, m, o);
          else if (d === 'away or draw' || d === 'x2') putSb(odds, 'dc_X2', v, m, o);
        }
        break;
      }
      default: break;
    }
  }
  return odds;
}

// ═══════════════════════════════════════════════════════════════
// PARSEUR TENNIS (SportRadar UOF standard).
// Verifie via dict-sportybet-tennis probe : 24 marketIds distincts, 12 utiles.
// Structure outcomes : id=4=Home, id=5=Away, id=12=Over, id=13=Under,
// id=1714=Home hcp, id=1715=Away hcp, id=70=Odd, id=72=Even.
// Specifier peut combiner : "setnr=1|hcp=-2.5" ou "setnr=1|total=9.5".
// ═══════════════════════════════════════════════════════════════
function sportybetTennisFlatOdds(markets) {
  const odds = { _ids: {} };
  if (!Array.isArray(markets)) return odds;
  for (const m of markets) {
    const id = String(m?.id || '');
    const outcomes = Array.isArray(m?.outcomes) ? m.outcomes : [];
    if (!outcomes.length) continue;
    const spec = String(m.specifier || '');
    const hcp = extractLine(spec, 'hcp');
    const total = extractLine(spec, 'total');
    const setnr = extractLine(spec, 'setnr');
    const setPfx = setnr ? `s${setnr}_` : '';
    for (const o of outcomes) {
      const v = Number(o?.odds);
      if (!Number.isFinite(v) || v <= 1) continue;
      const ocId = String(o?.id || '');
      switch (id) {
        case '186': // Winner
          if (ocId === '4') putSb(odds, 'match_1', v, m, o);
          else if (ocId === '5') putSb(odds, 'match_2', v, m, o);
          break;
        case '187': // Game handicap
          if (hcp != null && isHalfLine(Math.abs(hcp))) {
            if (ocId === '1714') putSb(odds, `hcp_home_${hcp}`, v, m, o);
            else if (ocId === '1715') putSb(odds, `hcp_away_${-hcp}`, v, m, o);
          }
          break;
        case '188': // Set handicap (±1.5)
          if (hcp != null) {
            if (ocId === '1714') putSb(odds, `hcp_sets_home_${hcp}`, v, m, o);
            else if (ocId === '1715') putSb(odds, `hcp_sets_away_${-hcp}`, v, m, o);
          }
          break;
        case '189': // Total games
          if (total != null && isHalfLine(total)) {
            if (ocId === '12') putSb(odds, `match_over_${total}`, v, m, o);
            else if (ocId === '13') putSb(odds, `match_under_${total}`, v, m, o);
          }
          break;
        case '190': // Player 1 (home) total games
          if (total != null && isHalfLine(total)) {
            if (ocId === '12') putSb(odds, `tt_home_over_${total}`, v, m, o);
            else if (ocId === '13') putSb(odds, `tt_home_under_${total}`, v, m, o);
          }
          break;
        case '191': // Player 2 (away) total games
          if (total != null && isHalfLine(total)) {
            if (ocId === '12') putSb(odds, `tt_away_over_${total}`, v, m, o);
            else if (ocId === '13') putSb(odds, `tt_away_under_${total}`, v, m, o);
          }
          break;
        case '196': // Exact sets (2 or 3)
          if (String(o.id).includes(':32')) putSb(odds, 'total_sets_2', v, m, o);
          else if (String(o.id).includes(':33')) putSb(odds, 'total_sets_3', v, m, o);
          break;
        case '198': // Odd/Even games
          if (ocId === '70') putSb(odds, 'odd', v, m, o);
          else if (ocId === '72') putSb(odds, 'even', v, m, o);
          break;
        case '202': // Set N winner (setnr=1 or 2)
          if (setnr) {
            if (ocId === '4') putSb(odds, `${setPfx}match_1`, v, m, o);
            else if (ocId === '5') putSb(odds, `${setPfx}match_2`, v, m, o);
          }
          break;
        case '203': // Set N game handicap
          if (setnr && hcp != null && isHalfLine(Math.abs(hcp))) {
            if (ocId === '1714') putSb(odds, `${setPfx}hcp_home_${hcp}`, v, m, o);
            else if (ocId === '1715') putSb(odds, `${setPfx}hcp_away_${-hcp}`, v, m, o);
          }
          break;
        case '204': // Set N total games
          if (setnr && total != null && isHalfLine(total)) {
            if (ocId === '12') putSb(odds, `${setPfx}over_${total}`, v, m, o);
            else if (ocId === '13') putSb(odds, `${setPfx}under_${total}`, v, m, o);
          }
          break;
        case '314': // Total sets 2.5
          if (total != null) {
            if (ocId === '12') putSb(odds, `total_sets_over_${total}`, v, m, o);
            else if (ocId === '13') putSb(odds, `total_sets_under_${total}`, v, m, o);
          }
          break;
        default: break;
      }
    }
  }
  return odds;
}
