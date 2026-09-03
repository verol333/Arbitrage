// Conversion des marches TENNIS MaxiBet (Swarm) vers le vocabulaire standard.
//
// Memes regles de surete que le foot :
//   1) WHITELIST des types techniques (69 types exposes, on n'en lit que 9) ;
//   2) DEMI-LIGNES SEULEMENT (MaxiBet publie aussi des lignes entieres : total
//      de jeux 38, handicap -4 -> remboursement, donc aucun arbitrage garanti) ;
//   3) GARDE « 1st » sur les marches de set : les types SetWinner / SetOverUnder
//      / SetHandicap portent toujours le 1er set chez MaxiBet, mais le libelle
//      est verifie pour ne jamais ecrire un 2e set dans les cles s1_.
//
// Vocabulaire cible (identique a apollo / betmomo / sportybet / yellowbet) :
//   match_1 / match_2                        vainqueur du match
//   match_over_<L> / match_under_<L>         total de jeux du match
//   hcp_home_<L> / hcp_away_<L>              handicap jeux
//   hcp_sets_home_<L> / hcp_sets_away_<L>    handicap sets
//   tt_home_over_<L> / tt_away_under_<L> ... jeux gagnes par joueur
//   s1_match_1 / s1_match_2                  vainqueur du 1er set
//   s1_over_<L> / s1_under_<L>               total de jeux du 1er set
//   s1_hcp_home_<L> / s1_hcp_away_<L>        handicap jeux du 1er set
//   odd / even                               total de jeux pair/impair
import { isHalfLine } from '../../core/markets.js';

const FIXED = {
  P1P2: { W1: 'match_1', W2: 'match_2' },
  TotalGamesOddorEven: { Odd: 'odd', Even: 'even' },
};

// Types dont le libelle DOIT parler du 1er set (garde anti-2e set).
const FIRST_SET = { SetWinner: { W1: 's1_match_1', W2: 's1_match_2' } };

// Over/Under : type -> [prefixe Over, prefixe Under].
const TOTALS = {
  'TotalGamesOver/Under': ['match_over_', 'match_under_'],
  "Player1:Player'sTotalofWonGames": ['tt_home_over_', 'tt_home_under_'],
  "Player2:Player'sTotalofWonGames": ['tt_away_over_', 'tt_away_under_'],
  SetOverUnder: ['s1_over_', 's1_under_'],
};

// Handicaps 2 voies : la ligne est portee par chaque issue, deja signee du point
// de vue de son camp (Home{-4.5} / Away{4.5}).
const HANDICAPS = {
  Handicap: ['hcp_home_', 'hcp_away_'],
  'Sets Handicap': ['hcp_sets_home_', 'hcp_sets_away_'],
  SetHandicap: ['s1_hcp_home_', 's1_hcp_away_'],
};

// Marches de set : le libelle doit contenir « 1st » (lang eng cote MaxiBet).
const SET_SCOPED = new Set(['SetWinner', 'SetOverUnder', 'SetHandicap']);
const isFirstSet = (name) => /\b1st\b/i.test(String(name || ''));

function put(odds, key, value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 1) return;
  if (odds[key] == null || v > odds[key]) odds[key] = v;
}

const fmt = (n) => String(Number(n));

export function maxibetTennisFlatOdds(markets = []) {
  const odds = {};
  for (const m of markets) {
    const type = m?.type;
    if (!type) continue;
    if (SET_SCOPED.has(type) && !isFirstSet(m.name)) continue;
    const events = Object.values(m.event || {});
    if (!events.length) continue;

    const fixed = FIXED[type] || FIRST_SET[type];
    if (fixed) {
      for (const e of events) {
        const key = fixed[e.type_1];
        if (key) put(odds, key, e.price);
      }
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
