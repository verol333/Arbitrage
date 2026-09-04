// Conversion des marchés HOCKEIE (glace) MaxiBet (Swarm) vers le vocabulaire standard.
// Swarm sport id=2 (Ice Hockey). On ne lit QUE les marchés match-level (regulation
// 3-way, total buts, handicap buts, totaux par equipe, pair/impair, double chance).
// Les marchés OT-inclus (P1P2), par periode, buteurs et scores exacts sont ignorés :
// ils ne sont pas comparables avec les autres books (regulation time) et casserait
// l'appariement. Demi-lignes seulement (isHalfLine) — aucune ligne entière (remboursement).
import { isHalfLine } from '../../core/markets.js';

// Match Result (Regular Time) 3-way = la base comparable en hockey.
const FIXED = {
  P1XP2: { W1: 'match_1', X: 'match_X', W2: 'match_2' },
  '1X12X2': { '1X': 'dc_1X', '12': 'dc_12', X2: 'dc_X2' },
  BothTeamsToScore: { Yes: 'btts_yes', No: 'btts_no' },
  OddEvenTotal: { Odd: 'odd', Even: 'even' },
};

const TOTALS = {
  MatchTotal2: ['match_over_', 'match_under_'],
  HomeTeamTotal: ['tt_home_over_', 'tt_home_under_'],
  AwayTeamTotal: ['tt_away_over_', 'tt_away_under_'],
};

const HANDICAPS = {
  MatchHandicap2: ['hcp_home_', 'hcp_away_'],
};

function put(odds, key, value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 1) return;
  if (odds[key] == null || v > odds[key]) odds[key] = v;
}
const fmt = (n) => String(Number(n));

export function maxibetHockeyFlatOdds(markets = []) {
  const odds = {};
  for (const m of markets) {
    const type = m?.type;
    if (!type) continue;
    const events = Object.values(m.event || {});
    if (!events.length) continue;

    const fixed = FIXED[type];
    if (fixed) {
      for (const e of events) { const key = fixed[e.type_1]; if (key) put(odds, key, e.price); }
      continue;
    }
    const total = TOTALS[type];
    if (total) {
      for (const e of events) {
        const line = Number(e.base);
        if (!Number.isFinite(line) || !isHalfLine(line)) continue;
        if (e.type_1 === 'Over') put(odds, total[0] + fmt(line), e.price);
        else if (e.type_1 === 'Under') put(odds, total[1] + fmt(line), e.price);
      }
      continue;
    }
    const hcp = HANDICAPS[type];
    if (hcp) {
      for (const e of events) {
        const line = Number(e.base);
        if (!Number.isFinite(line) || !isHalfLine(line)) continue;
        if (e.type_1 === 'Home') put(odds, hcp[0] + fmt(line), e.price);
        else if (e.type_1 === 'Away') put(odds, hcp[1] + fmt(line), e.price);
      }
    }
  }
  return odds;
}
