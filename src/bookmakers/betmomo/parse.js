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
      case 'SecondHalfDoubleChance': putDC('h2_'); break;
      case '2ndHalfBothTeamsToScore': putBtts('h2_'); break;
      case 'SecondHalfOverUnder':
      case '2ndHalfTotalOver/Under': putTotal('h2_'); break;    // Alias 2H total (audit prouvait mismatch)
      case 'SecondHalfAsianHandicap':
      case '2ndHalfAsianHandicap': putHcp('h2_'); break;         // Alias 2H handicap
      case 'SecondHalfTeam1OverUnder': putTeamTotal('home', 'h2_'); break;
      case 'SecondHalfTeam2OverUnder': putTeamTotal('away', 'h2_'); break;
      case 'DrawNoBet': {
        for (const e of list) {
          const ty = String(e.type_1 || e.type || '').toLowerCase();
          if (ty === 'home' || ty === 'w1' || ty === '1') odds.dnb_1 = price(e);
          else if (ty === 'away' || ty === 'w2' || ty === '2') odds.dnb_2 = price(e);
        } break;
      }
      case 'HalfTimeDrawNoBet': {
        for (const e of list) {
          const ty = String(e.type_1 || e.type || '').toLowerCase();
          if (ty === 'home' || ty === 'w1' || ty === '1') odds.ht_dnb_1 = price(e);
          else if (ty === 'away' || ty === 'w2' || ty === '2') odds.ht_dnb_2 = price(e);
        } break;
      }
      case 'SecondHalfDrawNoBet': {
        for (const e of list) {
          const ty = String(e.type_1 || e.type || '').toLowerCase();
          if (ty === 'home' || ty === 'w1' || ty === '1') odds.h2_dnb_1 = price(e);
          else if (ty === 'away' || ty === 'w2' || ty === '2') odds.h2_dnb_2 = price(e);
        } break;
      }
      case 'OddEven': {
        for (const e of list) {
          const ty = String(e.type_1 || e.type || e.name || '').toLowerCase();
          if (/odd|impair/.test(ty)) odds.odd = price(e);
          else if (/even|pair/.test(ty)) odds.even = price(e);
        } break;
      }
      case 'HalfTimeOddEven': {
        for (const e of list) {
          const ty = String(e.type_1 || e.type || e.name || '').toLowerCase();
          if (/odd|impair/.test(ty)) odds.ht_odd = price(e);
          else if (/even|pair/.test(ty)) odds.ht_even = price(e);
        } break;
      }
      case 'SecondHalfOddEven': {
        for (const e of list) {
          const ty = String(e.type_1 || e.type || e.name || '').toLowerCase();
          if (/odd|impair/.test(ty)) odds.h2_odd = price(e);
          else if (/even|pair/.test(ty)) odds.h2_even = price(e);
        } break;
      }
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
      case 'CornersOverUnder': putTotal('cor_'); break;
      case 'CornersAsianHandicap': putHcp('cor_'); break;
      case 'CornersOddEven': {
        for (const e of list) {
          const ty = String(e.type_1 || e.type || e.name || '').toLowerCase();
          if (/odd|impair/.test(ty)) odds.cor_odd = price(e);
          else if (/even|pair/.test(ty)) odds.cor_even = price(e);
        } break;
      }
      case 'HalfTimeCornersOverUnder': putTotal('cor_ht_'); break;
      case 'Team1CornersOverUnder': putTeamTotal('home', 'cor_'); break;
      case 'Team2CornersOverUnder': putTeamTotal('away', 'cor_'); break;
      // ─── TENNIS markets (BetMomo SWARM types) ─────────────────────────────
      case 'P1P2': put1x2(''); break; // Match Winner 2-way tennis
      case 'Handicap': {
        // Games Handicap MATCH-level SEULEMENT. Si m.group_name pointe un set
        // spécifique (1stSet, 2ndSet, etc.), on ignore pour éviter que la cote
        // d'un handicap de set particulier soit lue comme handicap match.
        // Audit tennis Bouzige vs Delaney : Handicap x4 tous en group="Match" — OK.
        const grp = String(m.group_name || '').toLowerCase();
        if (grp && !/^(match|handicaps?|regular time)/i.test(grp)) break;
        putHcp('');
        break;
      }
      case 'TotalGamesOver/Under': putTotal('match_'); break;
      case "Player1:Player'sTotalofWonGames": putTeamTotal('home', ''); break;
      case "Player2:Player'sTotalofWonGames": putTeamTotal('away', ''); break;
      case 'TotalGamesOdd/Even': {
        for (const e of list) {
          const ty = String(e.type_1 || e.type || e.name || '').toLowerCase();
          if (/odd|impair/.test(ty)) odds.odd = price(e);
          else if (/even|pair/.test(ty)) odds.even = price(e);
        } break;
      }
      // Alias tennis découverts via audit (naming inconsistant BetMomo).
      case 'Sets Handicap': {                                  // Alias de HandicapSets (avec espace)
        for (const e of list) {
          const base = Number(e.base);
          const ty = String(e.type_1 || e.type || '').toLowerCase();
          if (ty === '1' || ty === 'home') odds[`set_hcp_home_${base}`] = price(e);
          else if (ty === '2' || ty === 'away') odds[`set_hcp_away_${base}`] = price(e);
        } break;
      }
      case 'TotalGamesOddorEven': {                            // Alias de TotalGamesOdd/Even
        for (const e of list) {
          const ty = String(e.type_1 || e.type || e.name || '').toLowerCase();
          if (/odd|impair/.test(ty)) odds.odd = odds.odd || price(e);
          else if (/even|pair/.test(ty)) odds.even = odds.even || price(e);
        } break;
      }
      case 'TotalofSets': {                                    // Total sets tennis (base 2.5, 3.5 …)
        for (const e of list) {
          const base = Number(e.base);
          if (!isHalfLine(base)) continue;
          const ty = String(e.type_1 || e.type || '').toLowerCase();
          if (ty === 'over') odds[`set_over_${base}`] = price(e);
          else if (ty === 'under') odds[`set_under_${base}`] = price(e);
        } break;
      }
      case '1stSetWinner': put1x2('s1_'); break;
      case '1stSetTotalGames': putTotal('s1_'); break;
      case '2ndSetWinner': put1x2('s2_'); break;
      case '2ndSetTotalGames': putTotal('s2_'); break;
      case '3rdSetWinner': put1x2('s3_'); break;
      case '3rdSetTotalGames': putTotal('s3_'); break;
      // ─── VOLLEYBALL (BetConstruct types) ───────────────────────────────────
      case 'MatchWinner': put1x2(''); break; // Volley 2-way (peut aussi tomber sur P1P2)
      case 'TotalSets': putTotal('set_'); break;
      case '4thSetWinner': put1x2('s4_'); break;
      case '4thSetTotalPoints': putTotal('s4_'); break;
      case '5thSetWinner': put1x2('s5_'); break;
      case '5thSetTotalPoints': putTotal('s5_'); break;
      case '1stSetTotalPoints': putTotal('s1_'); break;
      case '2ndSetTotalPoints': putTotal('s2_'); break;
      case '3rdSetTotalPoints': putTotal('s3_'); break;
      case 'HandicapSets': {
        for (const e of list) {
          const base = Number(e.base);
          const ty = String(e.type_1 || e.type || '').toLowerCase();
          if (ty === '1' || ty === 'home') odds[`set_hcp_home_${base}`] = price(e);
          else if (ty === '2' || ty === 'away') odds[`set_hcp_away_${base}`] = price(e);
        } break;
      }
      // ─── BASKETBALL (BetConstruct types) ───────────────────────────────────
      // Marchés MATCH plein temps (les vrais noms BetMomo basket) :
      case 'MatchTotal': putTotal('match_'); break;          // Total points match
      case 'MatchHandicap': putHcp(''); break;                // Handicap points match
      case 'MatchHomeTeamTotal2': {                            // Total points team 1 match
        for (const e of list) {
          const base = Number(e.base);
          if (!isHalfLine(base)) continue;
          const ty = String(e.type_1 || e.type || '').toLowerCase();
          if (ty === 'over') odds[`tt_home_over_${base}`] = price(e);
          else if (ty === 'under') odds[`tt_home_under_${base}`] = price(e);
        } break;
      }
      case 'MatchAwayTeamTotal2': {                            // Total points team 2 match
        for (const e of list) {
          const base = Number(e.base);
          if (!isHalfLine(base)) continue;
          const ty = String(e.type_1 || e.type || '').toLowerCase();
          if (ty === 'over') odds[`tt_away_over_${base}`] = price(e);
          else if (ty === 'under') odds[`tt_away_under_${base}`] = price(e);
        } break;
      }
      case 'MatchOddEvenTotal': {                              // Odd/Even points match
        for (const e of list) {
          const ty = String(e.type_1 || e.type || e.name || '').toLowerCase();
          if (/odd|impair/.test(ty)) odds.odd = odds.odd || price(e);
          else if (/even|pair/.test(ty)) odds.even = odds.even || price(e);
        } break;
      }
      // Quarters explicites (numérotés) — OK.
      case 'Quarter1Winner': put1x2('q1_'); break;
      case 'Quarter1TotalPoints': putTotal('q1_'); break;
      case 'Quarter1AsianHandicap': putHcp('q1_'); break;
      case 'Quarter2Winner': put1x2('q2_'); break;
      case 'Quarter2TotalPoints': putTotal('q2_'); break;
      case 'Quarter3Winner': put1x2('q3_'); break;
      case 'Quarter3TotalPoints': putTotal('q3_'); break;
      case 'Quarter4Winner': put1x2('q4_'); break;
      case 'Quarter4TotalPoints': putTotal('q4_'); break;
      // IGNORÉS : Quarter* sans numéro — ambigus.
      case 'QuarterTotal': break;
      case 'QuarterHandicap': break;
      case 'QuarterHomeTeamTotal2': break;
      case 'QuarterAwayTeamTotal2': break;
      case 'QuarterOddEvenTotal': break;
      // IGNORÉS : Team1/2TotalOdd/Even — pas de slot dédié team odd/even.
      case 'Team1TotalOdd/Even': break;
      case 'Team2TotalOdd/Even': break;
      // ─── ICE HOCKEY (BetConstruct types) ───────────────────────────────────
      case '1stPeriodResult': put1x2('p1_'); break;
      case '1stPeriodOverUnder': putTotal('p1_'); break;
      case '1stPeriodAsianHandicap': putHcp('p1_'); break;
      case '2ndPeriodResult': put1x2('p2_'); break;
      case '2ndPeriodOverUnder': putTotal('p2_'); break;
      case '3rdPeriodResult': put1x2('p3_'); break;
      case '3rdPeriodOverUnder': putTotal('p3_'); break;
      // Hockey Regular-Time markets (BetConstruct — audit prouvait 50 markets
      // dispo mais parseur n'en lisait que 6 sur Finland U20 vs Sweden U20).
      case 'MatchHandicap2': putHcp(''); break;                  // Match handicap plein temps
      case 'MatchTotal2': putTotal('match_'); break;             // Total buts match plein temps
      case 'HomeTeamTotal': putTeamTotal('home', ''); break;     // Total buts équipe domicile match
      case 'AwayTeamTotal': putTeamTotal('away', ''); break;     // Total buts équipe extérieur match
      case 'OddEvenTotal': {                                     // Odd/Even total buts match
        for (const e of list) {
          const ty = String(e.type_1 || e.type || e.name || '').toLowerCase();
          if (/odd|impair/.test(ty)) odds.odd = odds.odd || price(e);
          else if (/even|pair/.test(ty)) odds.even = odds.even || price(e);
        } break;
      }
      // Variants Asian ignored (base=.75/.25 non half-line, parseur les rejette
      // déjà via isHalfLine, mais on les liste pour ne pas les traiter accidentellement) :
      case 'MatchHandicap2Asian':
      case 'MatchTotal2Asian':
      case 'HomeTeamTotalAsian':
      case 'AwayTeamTotalAsian':
      case 'HalfTimeOverUnderAsian':
      case 'HalfTimeTeam1OverUnderAsian':
      case 'HalfTimeTeam2OverUnderAsian':
      case 'Team1TotalOverUnderAsian':
      case 'Team2TotalOverUnderAsian': break;
      // IGNORÉS : PeriodHomeTeamTotal / PeriodAwayTeamTotal n'indiquent PAS
      // le numéro de période dans le type — les stocker sous tt_home_* créait
      // des surebets fantômes (comparés à d'autres marchés hockey chez 1xBet).
      // À réactiver quand on aura le group_name qui porte "P1", "P2", "P3".
      case 'PeriodHomeTeamTotal': break;
      case 'PeriodAwayTeamTotal': break;
      // ─── VOLLEYBALL (BetConstruct types complémentaires) ──────────────────
      case 'PointHandicap': putHcp(''); break;
      case 'SetHandicap': {
        for (const e of list) {
          const base = Number(e.base);
          const ty = String(e.type_1 || e.type || '').toLowerCase();
          if (ty === 'home' || ty === '1') odds[`set_hcp_home_${base}`] = price(e);
          else if (ty === 'away' || ty === '2') odds[`set_hcp_away_${base}`] = price(e);
        } break;
      }
      // IGNORÉ : SetPointHandicap ambigu (quel set ?) — pollue set_hcp_*.
      case 'SetPointHandicap': break;
      // IGNORÉ : SetWinner sans numéro — écrasait match_1/2 réel.
      case 'SetWinner': break;
      // IGNORÉ : SetTotalOverUnder ambigu (points d'UN set non identifié,
      // pas nombre de sets du match). Se confond avec set_over/under si mal
      // lu — désactivé pour éviter la comparaison croisée.
      case 'SetTotalOverUnder': break;
      // IGNORÉ : Team1SetTotalOverUnder / Team2SetTotalOverUnder sont des
      // totaux points par team sur UN set, PAS le total team match. Les mapper
      // vers tt_home/tt_away écrasait les vrais totaux team match.
      case 'Team1SetTotalOverUnder': break;
      case 'Team2SetTotalOverUnder': break;
      // Vrais team totals MATCH volley (BetMomo les expose sous ces noms) :
      case 'HomeTeamOver/Under': {
        for (const e of list) {
          const base = Number(e.base);
          if (!isHalfLine(base)) continue;
          const ty = String(e.type_1 || e.type || '').toLowerCase();
          if (ty === 'over') odds[`tt_home_over_${base}`] = price(e);
          else if (ty === 'under') odds[`tt_home_under_${base}`] = price(e);
        } break;
      }
      case 'AwayTeamOver/Under': {
        for (const e of list) {
          const base = Number(e.base);
          if (!isHalfLine(base)) continue;
          const ty = String(e.type_1 || e.type || '').toLowerCase();
          if (ty === 'over') odds[`tt_away_over_${base}`] = price(e);
          else if (ty === 'under') odds[`tt_away_under_${base}`] = price(e);
        } break;
      }
      case 'TotalPointsOver/Under': putTotal('match_'); break;
      // IGNORÉ : TotalbySets = total exact (3/4/5), non convertible en over/under.
      case 'TotalbySets': break;
      case 'MatchTotalEvenOdd': {
        for (const e of list) {
          const ty = String(e.type_1 || e.type || e.name || '').toLowerCase();
          if (/odd|impair/.test(ty)) odds.odd = odds.odd || price(e);
          else if (/even|pair/.test(ty)) odds.even = odds.even || price(e);
        } break;
      }
      // IGNORÉ : SetEvenOddTotal = odd/even d'UN set non identifié → écrasait
      // le vrai odd/even MATCH (source de la fausse opp volley China-Turkey
      // où Impair=2.23 était en fait Odd d'un set).
      case 'SetEvenOddTotal': break;
      default: break;
    }
  }
  return odds;
}
