// Parseur football BetMomo (marchés SWARM bruts → cotes plates standard).
// Un seul switch sur `market.type`. Chaque case émet des clés standardisées.
import { isHalfLine } from '../../core/markets.js';

export function betmomoFlatOdds(markets) {
  const odds = {};
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
        if (ty === 'w1' || ty === 'home' || ty === '1') odds[`${pfx}match_1`] = price(e);
        else if (ty === 'x' || ty === 'draw') odds[`${pfx}match_X`] = price(e);
        else if (ty === 'w2' || ty === 'away' || ty === '2') odds[`${pfx}match_2`] = price(e);
      }
    };
    const putDC = (pfx) => {
      for (const e of list) {
        const ty = String(e.type_1 || e.type || '').toLowerCase().replace(/\s/g, '');
        if (ty === '1x' || ty === 'x1') odds[`${pfx}dc_1X`] = price(e);
        else if (ty === '12' || ty === '21') odds[`${pfx}dc_12`] = price(e);
        else if (ty === 'x2' || ty === '2x') odds[`${pfx}dc_X2`] = price(e);
      }
    };
    const putBtts = (pfx) => {
      for (const e of list) {
        const ty = String(e.type_1 || e.type || e.name || '').toLowerCase();
        if (/yes|oui/.test(ty)) odds[`${pfx}btts_yes`] = price(e);
        else if (/no|non/.test(ty)) odds[`${pfx}btts_no`] = price(e);
      }
    };
    const putTotal = (pfx) => {
      for (const e of list) {
        const base = Number(e.base);
        if (!isHalfLine(base)) continue;
        const ty = String(e.type_1 || e.type || '').toLowerCase();
        if (ty === 'over') odds[`${pfx}over_${base}`] = price(e);
        else if (ty === 'under') odds[`${pfx}under_${base}`] = price(e);
      }
    };
    const putTeamTotal = (side, pfx) => {
      for (const e of list) {
        const base = Number(e.base);
        if (!isHalfLine(base)) continue;
        const ty = String(e.type_1 || e.type || '').toLowerCase();
        if (ty === 'over') odds[`${pfx}tt_${side}_over_${base}`] = price(e);
        else if (ty === 'under') odds[`${pfx}tt_${side}_under_${base}`] = price(e);
      }
    };
    const putHcp = (pfx) => {
      for (const e of list) {
        const base = Number(e.base);
        if (!isHalfLine(base)) continue;
        const ty = String(e.type_1 || e.type || '').toLowerCase();
        if (ty === 'home') odds[`${pfx}hcp_home_${base}`] = price(e);
        else if (ty === 'away') odds[`${pfx}hcp_away_${base}`] = price(e);
      }
    };
    const putOddEven = (pfx) => {
      for (const e of list) {
        const ty = String(e.type_1 || e.type || e.name || '').toLowerCase();
        if (/odd|impair/.test(ty)) odds[`${pfx}odd`] = price(e);
        else if (/even|pair/.test(ty)) odds[`${pfx}even`] = price(e);
      }
    };
    const putDnb = (pfx) => {
      for (const e of list) {
        const ty = String(e.type_1 || e.type || '').toLowerCase();
        if (ty === 'home' || ty === 'w1' || ty === '1') odds[`${pfx}dnb_1`] = price(e);
        else if (ty === 'away' || ty === 'w2' || ty === '2') odds[`${pfx}dnb_2`] = price(e);
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
          if (ty === 'home' || ty === 'w1' || ty === '1') odds.fts_home = price(e);
          else if (ty === 'away' || ty === 'w2' || ty === '2') odds.fts_away = price(e);
          else if (/no goal|none|neither/.test(ty)) odds.fts_none = price(e);
        } break;
      }
      case 'HalfWithMostGoals': case 'HighestScoringHalf': {
        for (const e of list) {
          const ty = String(e.type_1 || e.type || '').toLowerCase();
          if (ty === '1st half' || ty === '1' || ty === 'first') odds.half_most_ht = price(e);
          else if (ty === '2nd half' || ty === '2' || ty === 'second') odds.half_most_h2 = price(e);
          else if (/equal|tie|draw|x/.test(ty)) odds.half_most_equal = price(e);
        } break;
      }

      default: break;
    }
  }
  return odds;
}
