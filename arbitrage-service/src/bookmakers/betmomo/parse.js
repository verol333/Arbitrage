// Parseur football BetMomo (marchés SWARM bruts → cotes plates standard).
// Port fidèle de shared/betmomoParse.ts.
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

    switch (t) {
      case 'P1XP2': put1x2(''); break;
      case '1X12X2': putDC(''); break;
      case 'BothTeamsToScore': putBtts(''); break;
      case 'OverUnder': putTotal('match_'); break;
      case 'AsianHandicap': putHcp(''); break;
      case 'Team1OverUnder': putTeamTotal('home', ''); break;
      case 'Team2OverUnder': putTeamTotal('away', ''); break;
      case 'HalfTimeResult': put1x2('ht_'); break;
      case 'HalfTimeDoubleChance': putDC('ht_'); break;
      case '1stHalfBothTeamsToScore': putBtts('ht_'); break;
      case 'HalfTimeOverUnder': putTotal('ht_'); break;
      case 'HalfTimeAsianHandicap': putHcp('ht_'); break;
      case 'HalfTimeTeam1OverUnder': putTeamTotal('home', 'ht_'); break;
      case 'HalfTimeTeam2OverUnder': putTeamTotal('away', 'ht_'); break;
      case 'SecondHalfResult': put1x2('h2_'); break;
      case 'CornersOverUnder': putTotal('cor_'); break;
      case 'HalfTimeCornersOverUnder': putTotal('cor_ht_'); break;
      default: break;
    }
  }
  return odds;
}
