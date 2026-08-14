// Parseur football BetMomo (marchés SWARM bruts → cotes plates standard).
// Un seul switch sur `market.type`. Chaque case émet des clés standardisées.
import { isHalfLine } from '../../core/markets.js';


// Helper : ecrit odds[k] = v ET odds._ids[k] = { marketType, marketName,
// groupId, groupName, eventType, eventName, gameId, base } — champs SWARM
// natifs BetMomo requis SaveCoupon /image-creator/share-booking/ (body inclut
// siteId + events avec eventId+gameId+price+betType). eventId (matchId) et
// siteId (211) ajoutes par collect.js.
function putBm(odds, k, v, m, e) {
  odds[k] = v;
  if (!odds._ids) odds._ids = {};
  odds._ids[k] = {
    marketType: String(m?.type ?? ''),
    marketName: String(m?.name ?? ''),
    groupId: m?.group_id ?? null,
    groupName: String(m?.group_name ?? ''),
    eventType: String(e?.type ?? ''),
    eventName: String(e?.name ?? ''),
    gameId: e?.game_id ?? e?.gameId ?? null,
    base: e?.base ?? null,
    price: v,
    market_name_native: String(m?.name ?? ''),
    selection_name_native: String(e?.name ?? ''),
    market_path_native: m?.group_name ? String(m.group_name) : null,
  };
}

export function betmomoFlatOdds(markets, { sport = 'football' } = {}) {
  if (sport === 'tennis') return betmomoTennisFlatOdds(markets);
  if (sport === 'basket') return betmomoBasketFlatOdds(markets);
  if (sport === 'hockey') return betmomoHockeyFlatOdds(markets);
  // Volleyball : structure sets similaire tennis (P1P2 winner, SetWinner s1/s2/s3,
  // Handicap points, MatchTotal points, Sets Handicap, Odd/Even).
  if (sport === 'volleyball') return betmomoTennisFlatOdds(markets);
  const odds = { _ids: {} };
  const evs = (m) => (Array.isArray(m.event) ? m.event : Object.values(m.event || {}));
  const price = (e) => Number(e.price);
  const ok = (e) => e && e.price != null && Number(e.price) > 1;

  for (const m of markets) {
    const t = String(m.type || '');
    const list = evs(m).filter(ok);
    if (!list.length) continue;

    const put1x2 = (pfx) => {
      for (const e of list) {
        const ty = String(e.type_1 || e.type || '').toLowerCase();
        if (ty === 'w1' || ty === 'home' || ty === '1') putBm(odds, `${pfx}match_1`, price(e), m, e);
        else if (ty === 'x' || ty === 'draw') putBm(odds, `${pfx}match_X`, price(e), m, e);
        else if (ty === 'w2' || ty === 'away' || ty === '2') putBm(odds, `${pfx}match_2`, price(e), m, e);
      }
    };
    const putDC = (pfx) => {
      for (const e of list) {
        const ty = String(e.type_1 || e.type || '').toLowerCase().replace(/\s/g, '');
        if (ty === '1x' || ty === 'x1') putBm(odds, `${pfx}dc_1X`, price(e), m, e);
        else if (ty === '12' || ty === '21') putBm(odds, `${pfx}dc_12`, price(e), m, e);
        else if (ty === 'x2' || ty === '2x') putBm(odds, `${pfx}dc_X2`, price(e), m, e);
      }
    };
    const putBtts = (pfx) => {
      for (const e of list) {
        const ty = String(e.type_1 || e.type || e.name || '').toLowerCase();
        if (/yes|oui/.test(ty)) putBm(odds, `${pfx}btts_yes`, price(e), m, e);
        else if (/no|non/.test(ty)) putBm(odds, `${pfx}btts_no`, price(e), m, e);
      }
    };
    const putTotal = (pfx) => {
      for (const e of list) {
        const base = Number(e.base);
        if (!isHalfLine(base)) continue;
        const ty = String(e.type_1 || e.type || '').toLowerCase();
        if (ty === 'over') putBm(odds, `${pfx}over_${base}`, price(e), m, e);
        else if (ty === 'under') putBm(odds, `${pfx}under_${base}`, price(e), m, e);
      }
    };
    const putTeamTotal = (side, pfx) => {
      for (const e of list) {
        const base = Number(e.base);
        if (!isHalfLine(base)) continue;
        const ty = String(e.type_1 || e.type || '').toLowerCase();
        if (ty === 'over') putBm(odds, `${pfx}tt_${side}_over_${base}`, price(e), m, e);
        else if (ty === 'under') putBm(odds, `${pfx}tt_${side}_under_${base}`, price(e), m, e);
      }
    };
    const putHcp = (pfx) => {
      for (const e of list) {
        const base = Number(e.base);
        if (!isHalfLine(base)) continue;
        const ty = String(e.type_1 || e.type || '').toLowerCase();
        if (ty === 'home') putBm(odds, `${pfx}hcp_home_${base}`, price(e), m, e);
        else if (ty === 'away') putBm(odds, `${pfx}hcp_away_${base}`, price(e), m, e);
      }
    };
    const putOddEven = (pfx) => {
      for (const e of list) {
        const ty = String(e.type_1 || e.type || e.name || '').toLowerCase();
        if (/odd|impair/.test(ty)) putBm(odds, `${pfx}odd`, price(e), m, e);
        else if (/even|pair/.test(ty)) putBm(odds, `${pfx}even`, price(e), m, e);
      }
    };
    const putDnb = (pfx) => {
      for (const e of list) {
        const ty = String(e.type_1 || e.type || '').toLowerCase();
        if (ty === 'home' || ty === 'w1' || ty === '1') putBm(odds, `${pfx}dnb_1`, price(e), m, e);
        else if (ty === 'away' || ty === 'w2' || ty === '2') putBm(odds, `${pfx}dnb_2`, price(e), m, e);
      }
    };

    switch (t) {
      // ─── Fulltime ─────────────────────────────────────────────────
      case 'P1XP2': put1x2(''); break;
      case '1X12X2': putDC(''); break;
      case 'BothTeamsToScore': putBtts(''); break;
      case 'DrawNoBet': putDnb(''); break;
      case 'OverUnder': putTotal('match_'); break;
      case 'AsianHandicap': putHcp(''); break;
      case 'Team1OverUnder': putTeamTotal('home', ''); break;
      case 'Team2OverUnder': putTeamTotal('away', ''); break;
      case 'OddEven': putOddEven(''); break;

      // ─── 1ère mi-temps ────────────────────────────────────────────
      case 'HalfTimeResult': put1x2('ht_'); break;
      case 'HalfTimeDoubleChance': putDC('ht_'); break;
      case '1stHalfBothTeamsToScore': putBtts('ht_'); break;
      case 'HalfTimeDrawNoBet': putDnb('ht_'); break;
      case 'HalfTimeOverUnder': putTotal('ht_'); break;
      case 'HalfTimeAsianHandicap': putHcp('ht_'); break;
      case 'HalfTimeTeam1OverUnder': putTeamTotal('home', 'ht_'); break;
      case 'HalfTimeTeam2OverUnder': putTeamTotal('away', 'ht_'); break;
      case 'HalfTimeOddEven': putOddEven('ht_'); break;

      // ─── 2ème mi-temps ────────────────────────────────────────────
      case 'SecondHalfResult': put1x2('h2_'); break;
      case 'SecondHalfDoubleChance': putDC('h2_'); break;
      case '2ndHalfBothTeamsToScore': putBtts('h2_'); break;
      case 'SecondHalfDrawNoBet': putDnb('h2_'); break;
      case 'SecondHalfOverUnder':
      case '2ndHalfTotalOver/Under': putTotal('h2_'); break;
      case 'SecondHalfAsianHandicap':
      case '2ndHalfAsianHandicap': putHcp('h2_'); break;
      case 'SecondHalfTeam1OverUnder': putTeamTotal('home', 'h2_'); break;
      case 'SecondHalfTeam2OverUnder': putTeamTotal('away', 'h2_'); break;
      case 'SecondHalfOddEven': putOddEven('h2_'); break;

      // ─── Corners ──────────────────────────────────────────────────
      case 'CornersOverUnder': putTotal('cor_'); break;
      case 'CornersAsianHandicap': putHcp('cor_'); break;
      case 'CornersOddEven': putOddEven('cor_'); break;
      case 'HalfTimeCornersOverUnder': putTotal('cor_ht_'); break;
      case 'Team1CornersOverUnder': putTeamTotal('home', 'cor_'); break;
      case 'Team2CornersOverUnder': putTeamTotal('away', 'cor_'); break;

      // ─── 3-way (première équipe à marquer, mi-temps la plus prolifique) ─
      case 'FirstTeamToScore': {
        for (const e of list) {
          const ty = String(e.type_1 || e.type || '').toLowerCase();
          if (ty === 'home' || ty === 'w1' || ty === '1') putBm(odds, 'fts_home', price(e), m, e);
          else if (ty === 'away' || ty === 'w2' || ty === '2') putBm(odds, 'fts_away', price(e), m, e);
          else if (/no goal|none|neither/.test(ty)) putBm(odds, 'fts_none', price(e), m, e);
        } break;
      }
      case 'HalfWithMostGoals': case 'HighestScoringHalf': {
        for (const e of list) {
          const ty = String(e.type_1 || e.type || '').toLowerCase();
          if (ty === '1st half' || ty === '1' || ty === 'first') putBm(odds, 'half_most_ht', price(e), m, e);
          else if (ty === '2nd half' || ty === '2' || ty === 'second') putBm(odds, 'half_most_h2', price(e), m, e);
          else if (/equal|tie|draw|x/.test(ty)) putBm(odds, 'half_most_equal', price(e), m, e);
        } break;
      }

      default: break;
    }
  }
  return odds;
}

// ═══════════════════════════════════════════════════════════════
// PARSEUR BASKET BetMomo (SWARM/BetConstruct, incl. OT).
// Validé via probe-basket-dump : ~100 markets par WNBA match.
// Convention keys : match_/hcp_/tt_ + prefixes q1_/q2_/q3_/q4_/h1_/h2_.
// Attention: pas de match_X pour basket incl OT (pas de nul possible).
// L'ordinal du quarter/half est dans market.name ("1st Quarter Total Points").
// ═══════════════════════════════════════════════════════════════
function periodPfxFromName(name) {
  const s = String(name || '').toLowerCase();
  if (/\b1st quarter\b/.test(s)) return 'q1_';
  if (/\b2nd quarter\b/.test(s)) return 'q2_';
  if (/\b3rd quarter\b/.test(s)) return 'q3_';
  if (/\b4th quarter\b/.test(s)) return 'q4_';
  if (/\b1st half\b/.test(s)) return 'h1_';
  if (/\b2nd half\b/.test(s)) return 'h2_';
  return '';
}

function betmomoBasketFlatOdds(markets) {
  const odds = { _ids: {} };
  if (!Array.isArray(markets) && typeof markets !== 'object') return odds;
  const list = Array.isArray(markets) ? markets : Object.values(markets || {});
  const evs = (m) => (Array.isArray(m.event) ? m.event : Object.values(m.event || {}));
  const price = (e) => Number(e.price);
  const okEvent = (e) => e && e.price != null && Number(e.price) > 1;

  for (const m of list) {
    const t = String(m.type || '');
    const name = String(m.name || '');
    const events = evs(m).filter(okEvent);
    if (!events.length) continue;

    // Winner 2-way : type P1P2 + name "Match Winner"
    if (t === 'P1P2' && /^match winner$/i.test(name)) {
      for (const e of events) {
        const et = String(e.type || '').toUpperCase();
        if (et === 'P1') putBm(odds, 'match_1', price(e), m, e);
        else if (et === 'P2') putBm(odds, 'match_2', price(e), m, e);
      }
      continue;
    }

    // Total match FT (incl OT) : type MatchTotal + name "Total Points"
    if (t === 'MatchTotal' && /total points/i.test(name)) {
      for (const e of events) {
        const base = Number(e.base);
        if (!isHalfLine(base)) continue;
        const et = String(e.type || '').toLowerCase();
        if (et === 'over') putBm(odds, `match_over_${base}`, price(e), m, e);
        else if (et === 'under') putBm(odds, `match_under_${base}`, price(e), m, e);
      }
      continue;
    }

    // Handicap match : type MatchHandicap + name "Points Handicap"
    if (t === 'MatchHandicap' && /points handicap/i.test(name)) {
      for (const e of events) {
        const base = Number(e.base);
        if (base == null || !isHalfLine(Math.abs(base))) continue;
        const et = String(e.type || '').toLowerCase();
        if (et === 'home') putBm(odds, `hcp_home_${base}`, price(e), m, e);
        else if (et === 'away') putBm(odds, `hcp_away_${base}`, price(e), m, e);
      }
      continue;
    }

    // TT home : type MatchHomeTeamTotal2 + name "Team 1 Total Points"
    if (t === 'MatchHomeTeamTotal2' && /team 1 total/i.test(name)) {
      for (const e of events) {
        const base = Number(e.base);
        if (!isHalfLine(base)) continue;
        const et = String(e.type || '').toLowerCase();
        if (et === 'over') putBm(odds, `tt_home_over_${base}`, price(e), m, e);
        else if (et === 'under') putBm(odds, `tt_home_under_${base}`, price(e), m, e);
      }
      continue;
    }

    // TT away
    if (t === 'MatchAwayTeamTotal2' && /team 2 total/i.test(name)) {
      for (const e of events) {
        const base = Number(e.base);
        if (!isHalfLine(base)) continue;
        const et = String(e.type || '').toLowerCase();
        if (et === 'over') putBm(odds, `tt_away_over_${base}`, price(e), m, e);
        else if (et === 'under') putBm(odds, `tt_away_under_${base}`, price(e), m, e);
      }
      continue;
    }

    // Odd/Even match
    if (t === 'MatchOddEvenTotal') {
      for (const e of events) {
        const et = String(e.type || '').toLowerCase();
        if (et === 'odd') putBm(odds, 'odd', price(e), m, e);
        else if (et === 'even') putBm(odds, 'even', price(e), m, e);
      }
      continue;
    }

    // Quarters/Halves : le prefix est extrait du name
    const pfx = periodPfxFromName(name);
    if (!pfx) continue;

    // Winner 2-way par période
    if (t === 'QuarterWinner2' || t === 'HalfWinner2') {
      for (const e of events) {
        const et = String(e.type || '').toUpperCase();
        if (et === 'P1') putBm(odds, `${pfx}match_1`, price(e), m, e);
        else if (et === 'P2') putBm(odds, `${pfx}match_2`, price(e), m, e);
      }
      continue;
    }

    // Total par période
    if (t === 'QuarterTotal' || t === 'HalfTotal') {
      for (const e of events) {
        const base = Number(e.base);
        if (!isHalfLine(base)) continue;
        const et = String(e.type || '').toLowerCase();
        if (et === 'over') putBm(odds, `${pfx}over_${base}`, price(e), m, e);
        else if (et === 'under') putBm(odds, `${pfx}under_${base}`, price(e), m, e);
      }
      continue;
    }

    // Handicap par période
    if (t === 'QuarterHandicap' || t === 'HalfHandicap') {
      for (const e of events) {
        const base = Number(e.base);
        if (base == null || !isHalfLine(Math.abs(base))) continue;
        const et = String(e.type || '').toLowerCase();
        if (et === 'home') putBm(odds, `${pfx}hcp_home_${base}`, price(e), m, e);
        else if (et === 'away') putBm(odds, `${pfx}hcp_away_${base}`, price(e), m, e);
      }
      continue;
    }

    // TT home par période
    if (t === 'QuarterHomeTeamTotal2' || t === 'HalfHomeTeamTotal2') {
      for (const e of events) {
        const base = Number(e.base);
        if (!isHalfLine(base)) continue;
        const et = String(e.type || '').toLowerCase();
        if (et === 'over') putBm(odds, `${pfx}tt_home_over_${base}`, price(e), m, e);
        else if (et === 'under') putBm(odds, `${pfx}tt_home_under_${base}`, price(e), m, e);
      }
      continue;
    }

    // TT away par période
    if (t === 'QuarterAwayTeamTotal2' || t === 'HalfAwayTeamTotal2') {
      for (const e of events) {
        const base = Number(e.base);
        if (!isHalfLine(base)) continue;
        const et = String(e.type || '').toLowerCase();
        if (et === 'over') putBm(odds, `${pfx}tt_away_over_${base}`, price(e), m, e);
        else if (et === 'under') putBm(odds, `${pfx}tt_away_under_${base}`, price(e), m, e);
      }
      continue;
    }

    // Odd/Even par période
    if (t === 'QuarterOddEvenTotal' || t === 'HalfOddEvenTotal') {
      for (const e of events) {
        const et = String(e.type || '').toLowerCase();
        if (et === 'odd') putBm(odds, `${pfx}odd`, price(e), m, e);
        else if (et === 'even') putBm(odds, `${pfx}even`, price(e), m, e);
      }
      continue;
    }
  }
  return odds;
}

// ═══════════════════════════════════════════════════════════════
// PARSEUR HOCKEY BetMomo (SWARM sportId=2). Verifie via probe-hockey-betmomo-raw
// (SKA-VMF vs Sokol Krasnoyarsk 46 markets, 21 types distincts).
// Types cross-book utiles :
//   P1XP2                   → match_1/X/2 (Regulation Time 3-way)
//   MatchTotal2             → match_over/under_L (Regular Time, base=X.5)
//   MatchHandicap2          → hcp_home/away_L (Regular Time)
//   HomeTeamTotal / AwayTeamTotal → tt_home/away_over/under_L (Reg Time)
//   OddEvenTotal            → odd/even (Reg Time)
//   1X12X2                  → dc_1X/12/X2
// P1P2 (Match Winner Including Overtime) : IGNORE — semantique differente (2-way
// incl OT) et pas comparable directement au 3-way regulation majoritaire. Sinon
// on melange incl-OT (aucune X) avec regulation (X existe) → fake arbs.
// Types SKIP : MatchTotal2Asian/MatchHandicap2Asian/*TeamTotalAsian (lignes .25/.75
// non half-lines), CorrectScore (granulaire), FirstTeamToScore, PeriodXxx (v2 TODO).
// ═══════════════════════════════════════════════════════════════
function betmomoHockeyFlatOdds(markets) {
  const odds = { _ids: {} };
  if (!Array.isArray(markets) && typeof markets !== 'object') return odds;
  const list = Array.isArray(markets) ? markets : Object.values(markets || {});
  const evs = (m) => (Array.isArray(m.event) ? m.event : Object.values(m.event || {}));
  const price = (e) => Number(e.price);
  const okEvent = (e) => e && e.price != null && Number(e.price) > 1;
  for (const m of list) {
    const t = String(m.type || '');
    const events = evs(m).filter(okEvent);
    if (!events.length) continue;
    if (t === 'P1XP2') {
      for (const e of events) {
        const et = String(e.type || '').toUpperCase();
        if (et === 'P1') putBm(odds, 'match_1', price(e), m, e);
        else if (et === 'X') putBm(odds, 'match_X', price(e), m, e);
        else if (et === 'P2') putBm(odds, 'match_2', price(e), m, e);
      }
      continue;
    }
    if (t === 'MatchTotal2') {
      for (const e of events) {
        const base = Number(e.base);
        if (!isHalfLine(base)) continue;
        const et = String(e.type || '').toLowerCase();
        if (et === 'over') putBm(odds, `match_over_${base}`, price(e), m, e);
        else if (et === 'under') putBm(odds, `match_under_${base}`, price(e), m, e);
      }
      continue;
    }
    if (t === 'MatchHandicap2') {
      for (const e of events) {
        const base = Number(e.base);
        if (base == null || !isHalfLine(Math.abs(base))) continue;
        const et = String(e.type || '').toLowerCase();
        if (et === 'home') putBm(odds, `hcp_home_${base}`, price(e), m, e);
        else if (et === 'away') putBm(odds, `hcp_away_${base}`, price(e), m, e);
      }
      continue;
    }
    if (t === 'HomeTeamTotal') {
      for (const e of events) {
        const base = Number(e.base);
        if (!isHalfLine(base)) continue;
        const et = String(e.type_1 || e.type || '').toLowerCase();
        if (et === 'over') putBm(odds, `tt_home_over_${base}`, price(e), m, e);
        else if (et === 'under') putBm(odds, `tt_home_under_${base}`, price(e), m, e);
      }
      continue;
    }
    if (t === 'AwayTeamTotal') {
      for (const e of events) {
        const base = Number(e.base);
        if (!isHalfLine(base)) continue;
        const et = String(e.type_1 || e.type || '').toLowerCase();
        if (et === 'over') putBm(odds, `tt_away_over_${base}`, price(e), m, e);
        else if (et === 'under') putBm(odds, `tt_away_under_${base}`, price(e), m, e);
      }
      continue;
    }
    if (t === 'OddEvenTotal') {
      for (const e of events) {
        const et = String(e.type || '').toLowerCase();
        if (et === 'odd') putBm(odds, 'odd', price(e), m, e);
        else if (et === 'even') putBm(odds, 'even', price(e), m, e);
      }
      continue;
    }
    if (t === '1X12X2') {
      for (const e of events) {
        const et = String(e.type || e.type_1 || '').toUpperCase();
        if (et === '1X') putBm(odds, 'dc_1X', price(e), m, e);
        else if (et === '12') putBm(odds, 'dc_12', price(e), m, e);
        else if (et === 'X2') putBm(odds, 'dc_X2', price(e), m, e);
      }
      continue;
    }
  }
  return odds;
}

// ═══════════════════════════════════════════════════════════════
// PARSEUR TENNIS BetMomo (SWARM/BetConstruct).
// Verifie via dict-betmomo-tennis probe : 15 types uniques, 11 utiles.
// Structure event : type=P1/P2/Home/Away/Over/Under/Odd/Even, base=line,
// name=W1/W2/Over/Under/etc.
// ═══════════════════════════════════════════════════════════════
function betmomoTennisFlatOdds(markets) {
  const odds = { _ids: {} };
  if (!Array.isArray(markets) && typeof markets !== 'object') return odds;
  const list = Array.isArray(markets) ? markets : Object.values(markets || {});
  const evs = (m) => (Array.isArray(m.event) ? m.event : Object.values(m.event || {}));
  const price = (e) => Number(e.price);

  for (const m of list) {
    const t = String(m.type || '');
    const name = String(m.name || '');
    const events = evs(m).filter(e => e && e.price != null && Number(e.price) > 1);
    if (!events.length) continue;

    for (const e of events) {
      const p = price(e);
      const et = String(e.type || '');
      const base = e.base != null && e.base !== '' ? Number(e.base) : null;

      if (t === 'P1P2' && name === 'Match Winner') {
        if (et === 'P1') putBm(odds, 'match_1', p, m, e);
        else if (et === 'P2') putBm(odds, 'match_2', p, m, e);
      } else if (t === 'Handicap' && name === 'Games Handicap' && base != null && isHalfLine(Math.abs(base))) {
        if (et === 'Home') putBm(odds, `hcp_home_${base}`, p, m, e);
        else if (et === 'Away') putBm(odds, `hcp_away_${base}`, p, m, e);
      } else if (t === 'TotalGamesOver/Under' && name === 'Total Games' && base != null && isHalfLine(base)) {
        if (et === 'Over') putBm(odds, `match_over_${base}`, p, m, e);
        else if (et === 'Under') putBm(odds, `match_under_${base}`, p, m, e);
      } else if (t === "Player1:Player'sTotalofWonGames" && base != null && isHalfLine(base)) {
        if (et === 'Over') putBm(odds, `tt_home_over_${base}`, p, m, e);
        else if (et === 'Under') putBm(odds, `tt_home_under_${base}`, p, m, e);
      } else if (t === "Player2:Player'sTotalofWonGames" && base != null && isHalfLine(base)) {
        if (et === 'Over') putBm(odds, `tt_away_over_${base}`, p, m, e);
        else if (et === 'Under') putBm(odds, `tt_away_under_${base}`, p, m, e);
      } else if (t === 'SetHandicap' && name === '1st Set Games Handicap' && base != null && isHalfLine(Math.abs(base))) {
        if (et === 'Home') putBm(odds, `s1_hcp_home_${base}`, p, m, e);
        else if (et === 'Away') putBm(odds, `s1_hcp_away_${base}`, p, m, e);
      } else if (t === 'SetOverUnder' && name === '1st Set Total Games' && base != null && isHalfLine(base)) {
        if (et === 'Over') putBm(odds, `s1_over_${base}`, p, m, e);
        else if (et === 'Under') putBm(odds, `s1_under_${base}`, p, m, e);
      } else if (t === 'Sets Handicap' && name === 'Sets Handicap' && base != null) {
        if (et === 'Home') putBm(odds, `hcp_sets_home_${base}`, p, m, e);
        else if (et === 'Away') putBm(odds, `hcp_sets_away_${base}`, p, m, e);
      } else if (t === 'TotalGamesOddorEven') {
        if (et === 'Odd') putBm(odds, 'odd', p, m, e);
        else if (et === 'Even') putBm(odds, 'even', p, m, e);
      } else if (t === 'SetWinner' && name === '1st Set Winner') {
        if (et === 'Home') putBm(odds, 's1_match_1', p, m, e);
        else if (et === 'Away') putBm(odds, 's1_match_2', p, m, e);
      } else if (t === 'TotalofSets' && base != null) {
        if (et === 'Over') putBm(odds, `total_sets_over_${base}`, p, m, e);
        else if (et === 'Under') putBm(odds, `total_sets_under_${base}`, p, m, e);
      }
    }
  }
  return odds;
}
