#!/usr/bin/env node
// SOLVEUR COMBINATOIRE : cherche des coverage sets multi-books multi-marches
// qui garantissent un profit >= seuil, en exploitant les marches exotiques
// (Correct Score, Winning Margin, Ecart de buts, HT/FT, Multigoals).
//
// Approche :
//  1. Fetch raw data pour top N matchs populaires (congobet, sportybet, apollo)
//  2. Extract tous les outcomes normalises {market, selection, odds, book}
//  3. Encode chaque outcome vers un bitmask de scores gagnants (grille 10x10 = 100 bits)
//  4. Pour chaque match, evalue les PATTERNS predefinis + enumeration limitee
//  5. Reporte les opps triees par profit descendant
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';
import { bpFetchEvent } from '../src/bookmakers/betpawa/api.js';
import { fetchMatchBts as ybFetchBts } from '../src/bookmakers/yellowbet/api.js';
import { sbFetchEvent } from '../src/bookmakers/sportybet/api.js';
import { apolloGet } from '../src/bookmakers/apollo/api.js';
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { FEED, COUNTRY, viaWorker } from '../src/bookmakers/xbet/api.js';
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';

const BOOKS = (process.env.SOLVER_BOOKS || '1xbet,congobet,betpawa,1win').split(',').map(s => s.trim());
const TOP_MATCHES = parseInt(process.env.SOLVER_TOP_MATCHES || '5', 10);
const MIN_PROFIT = parseFloat(process.env.MIN_PROFIT || '0'); // 0% = tout montrer pour diagnostic
const BANKROLL = parseFloat(process.env.SOLVER_BANKROLL || '100000'); // XOF pour calcul mises
const REQUIRE_DISJOINT = process.env.SOLVER_ALLOW_OVERLAP !== '1'; // par defaut, filtre disjoints
const GRID = 15; // grille scores 0..14 pour home et away = 225 cellules
// Pas de bit overflow : aucun match de football ne finit avec 15+ buts/equipe

const _skippedWinMargin = new Set();
let _classifiedCount = 0, _nullCount = 0, _trivialCount = 0, _quarterLineSkipped = 0;

// Detecte les lignes a quart (0.25, 0.75, 1.25, 1.75, ...) qui produisent
// des demi-gains/demi-pertes incompatibles avec le modele binaire de bitmask.
// Seules les demi-lignes (0.5, 1.5, 2.5) et les lignes entieres sont fiables.
function isQuarterLine(line) {
  const frac = Math.abs(line) % 0.5;
  return frac > 0.01 && frac < 0.49;
}

// ─── Score coverage : chaque outcome → bitmask sur 225 bits ────────────────
// Cellule (h, a) = bit index h*GRID + a.
const ALL_CELLS_MASK = ((1n << BigInt(GRID * GRID)) - 1n);

function cellBit(h, a) {
  if (h >= GRID || a >= GRID) return 0n; // score impossible en football (15+)
  return 1n << BigInt(h * GRID + a);
}

// Construit une mask a partir d'un predicat (h,a) → bool
function maskFromPredicate(pred) {
  let m = 0n;
  for (let h = 0; h < GRID; h++) for (let a = 0; a < GRID; a++) {
    if (pred(h, a)) m |= cellBit(h, a);
  }
  // Pas de bit overflow — la grille 15x15 couvre tous les scores
  // realistes en football (aucun match ne finit 15+ buts/equipe)
  return m;
}

// ─── Sous-classifieurs pour marches combines ─────────────────────────────
function classifyPart(part) {
  const p = part.trim().toLowerCase();
  if (/^1$|^home$|^(hôte|domicile)$/.test(p)) return maskFromPredicate((h,a) => h > a);
  if (/^x$|^draw$|^nul|^tie$|^egalit[eé]$/.test(p)) return maskFromPredicate((h,a) => h === a);
  if (/^2$|^away$|^ext[eé]rieur$|^visiteur$/.test(p)) return maskFromPredicate((h,a) => a > h);
  if (/^1x$|^home\/draw$/.test(p)) return maskFromPredicate((h,a) => h >= a);
  if (/^x2$|^draw\/away$/.test(p)) return maskFromPredicate((h,a) => a >= h);
  if (/^12$|^home\/away$/.test(p)) return maskFromPredicate((h,a) => h !== a);
  if (/^yes$|^oui$|^y$|^both teams (?:to )?score$|^btts$/.test(p)) return maskFromPredicate((h,a) => h >= 1 && a >= 1);
  if (/^no$|^non$|^n$|^both teams not to score$|^no btts$/.test(p)) return maskFromPredicate((h,a) => h === 0 || a === 0);
  if (/^dr$/.test(p)) return maskFromPredicate((h,a) => h === a);
  let ov = p.match(/^over\s*([\d.]+)$|^plus (?:de )?([\d.]+)$|^>\s*([\d.]+)$/);
  if (ov) { const line = parseFloat(ov[1] || ov[2] || ov[3]); if (isQuarterLine(line)) { _quarterLineSkipped++; return null; } return maskFromPredicate((h,a) => (h + a) > line); }
  let un = p.match(/^under\s*([\d.]+)$|^moins (?:de )?([\d.]+)$|^<\s*([\d.]+)$/);
  if (un) { const line = parseFloat(un[1] || un[2] || un[3]); if (isQuarterLine(line)) { _quarterLineSkipped++; return null; } return maskFromPredicate((h,a) => (h + a) < line); }
  const sc = p.match(/^(\d+)\s*[:\-]\s*(\d+)$/);
  if (sc) return cellBit(parseInt(sc[1]), parseInt(sc[2]));
  return null;
}

// Detecte les marches combines (ex: "Under 2.5 & Yes", "1/no", "Home & Over 1.5")
function trySplitCombined(market, selection) {
  let raw = selection.toLowerCase().replace(/\[[^\]]*\]/g, '').trim();
  const parts = raw.split(/\s*[&/]\s*|\s+-\s+|\s+and\s+/).map(x => x.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  // Extract line from market name brackets (e.g., "Double Chance and Totals - FT [1.5]" → 1.5)
  const marketLineMatch = market.match(/\[\s*([\d.]+)\s*\]/);
  const marketLine = marketLineMatch ? marketLineMatch[1] : null;
  const masks = [];
  for (let part of parts) {
    // Bare "over"/"under" without a number — append line from market name
    if (marketLine && /^(over|under|plus|moins)$/i.test(part)) {
      part = part + ' ' + marketLine;
    }
    const mm = classifyPart(part);
    if (mm == null) return null;
    masks.push(mm);
  }
  let combined = masks[0];
  for (let i = 1; i < masks.length; i++) combined &= masks[i];
  if (combined === 0n) return null;
  return combined;
}

// ─── Classification d'un outcome en bitmask ────────────────────────────────
// Retourne le bitmask ou null si l'outcome n'est pas classifiable (HT-based, corners, cards, etc.)
// WHITELIST stricte des marches supportes. Tout marche non dans cette liste
// est skippe pour eviter les faux positifs sur des marches exotiques
// (ex: "Away Team Or GG/NG", "GG/NG 2+", "Matchbet + BTTS" combines complexes).
const WHITELIST_MARKETS = [
  // ── Correct Score ──
  /^correct score/i,
  /^score exact/i,
  /^score$/i,

  // ── 1X2 / Match Result ──
  /^1x2$/i,
  /^1x2 - ft$/i,
  /^basic offer$/i,
  /^match result$/i,
  /^r[eé]sultat du match$/i,
  /^full time result/i,
  /^result$/i,
  /^match winner$/i,

  // ── Double Chance ──
  /^double chance/i,

  // ── Draw No Bet ──
  /^draw no bet/i,
  /^victoire d'une des deux [eé]quipes$/i,

  // ── BTTS ──
  // Uniquement le BTTS temps plein "nu" : "in both halves", "1st half.",
  // "and totals"... sont des marches DIFFERENTS, non projetables tels quels.
  /^both teams to score(?: -? ?ft)?$/i,
  /^btts(?: -? ?ft)?$/i,
  /^les deux [eé]quipes marquent$/i,
  /^gg\/ng/i,
  /^goal\/no goal/i,

  // ── Over/Under total match ──
  /^over\/under/i,
  /^total goals/i,
  /^total$/i,
  /^nombre de buts$/i,
  /^total score over\/under - ft$/i,

  // ── Team Totals ──
  /^total score over\/under - ft - home team/i,
  /^total score over\/under - ft - away team/i,
  /^team 1 total$/i,
  /^team 2 total$/i,
  /^nombre de buts de /i,
  /^total de buts de /i,
  /^nombre exact de buts inscrits par /i,
  // Forme anglaise 1win/BetPawa : "<Nom d'equipe> Total" (ex "Athletic Bilbao
  // Total" -> Over 1.5). C'est la plus grosse famille jusqu'ici ignoree (160
  // types). Le classifieur refuse ensuite la cote si aucune equipe n'est
  // identifiable, donc cette entree permissive ne cree pas de faux marches.
  /\btotal(?: goals)?\b/i,

  // ── Multigoals ──
  /^multigoals?/i,

  // ── Winning Margin ──
  /^winning margin/i,
  /^marge du vainqueur/i,
  /^ecart entre [eé]quipes/i,
  /^ecart de buts/i,

  // ── Handicap ──
  /^handicap$/i,
  /^handicap goals/i,
  /^handicap europ[eé]en/i,
  /^handicap 1x2 - ft/i,
  /^asian handicap - ft/i,

  // ── Exact Goals ──
  /^nombre exact de buts$/i,
  /^exact (?:number of )?goals$/i,

  // ── Odd/Even ──
  /^odd\s*\/\s*even/i,

  // ── Combined markets ──
  /^r[eé]sultat du match et nombre de buts$/i,
  /^double chance et nombre de buts$/i,
  /^matchbet and totals/i,
  /^1x2 \& over\/under$/i,
  /^1x2 and totals/i,
  /^1x2 and both teams to score/i,
  /^double chance \& total$/i,
  /^double chance and totals/i,
  /^result and both teams to score/i,
  /^result and total/i,
  /^total and both teams to score/i,
  /^les deux [eé]quipes marquent et nombre de buts$/i,
  /^r[eé]sultat du match et les deux [eé]quipes marquent$/i,
  /^double chance et les deux [eé]quipes marquent$/i,

  // ── Clean Sheet / Win to Nil ──
  /^to win to nil/i,
  /^clean sheet/i,
  /gagne sans encaisser/i,
  /n'encaisse pas de but/i,
];
function isSupportedMarket(m) {
  return WHITELIST_MARKETS.some(re => re.test(m));
}

const _skippedMarkets = new Set();
function teamMatchScore(market, team) {
  if (!team) return 0;
  const ml = market.toLowerCase();
  const words = team.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
  if (words.length === 0) return 0;
  let matched = 0;
  for (const w of words) if (ml.includes(w)) matched++;
  return matched / words.length;
}

function isAwayTeamInMarket(market, homeTeam, awayTeam) {
  if (!homeTeam || !awayTeam) return false;
  const homeScore = teamMatchScore(market, homeTeam);
  const awayScore = teamMatchScore(market, awayTeam);
  if (awayScore >= 0.5 && awayScore > homeScore) return true;
  return false;
}

function isHomeTeamInMarket(market, homeTeam, awayTeam) {
  if (!homeTeam || !awayTeam) return false;
  const homeScore = teamMatchScore(market, homeTeam);
  const awayScore = teamMatchScore(market, awayTeam);
  if (homeScore >= 0.5 && homeScore > awayScore) return true;
  return false;
}

function classifyOutcome({ market, selection, odds, homeTeam, awayTeam }) {
  const m = String(market).toLowerCase();
  const s = String(selection).toLowerCase();

  // FIX #2 : filtre cotes phantom
  if (odds >= 40) return null;

  // FIX #4 : whitelist stricte — skip tout marche non explicitement supporte
  if (!isSupportedMarket(m)) {
    _skippedMarkets.add(m);
    return null;
  }

  // Skip les marches HT-only (pas classifiables sans le score MT)
  if (/1[eè]re mi[- ]?temps|1st half|2nd half|2[eè]me mi[- ]?temps|halftime\/fulltime|halftime|halftime\s*correct/i.test(m)) return null;
  if (/^1\. halftime|^2\. halftime|1st half|2nd half|ht\/ft|hi-temps|mi-temps|résultat mi-temps|mi temps|premi[eè]re|deuxi[eè]me/i.test(m)) return null;
  if (/- [12]h\b/i.test(m)) return null;
  if (/goalnr|xth goal|minsnr|match result after|when.*first goal|quand.*premier/i.test(m)) return null;
  if (/corner|carton|card|shot|foul|offside|throw/i.test(m)) return null;
  if (/first to score|first team|first goal|premier but|1er but/i.test(m)) return null;
  if (/half time with more|halftime with more|mi-temps.*plus|excluded goals/i.test(m)) return null;
  if (/multiscores/i.test(m)) return null; // trop complexes a parser (1:0, 2:0 or 3:0)
  if (/goal bounds/i.test(m)) return null; // ambigu (parfois home only, parfois away)

  // ─ Winning Margin (SportyBet, Congobet, BetPawa) — AVANT trySplitCombined
  // car les selections "2 / >2" seraient mal interpretees par classifyPart
  // qui lirait ">2" comme "total > 2" au lieu de "marge > 2"
  if (/winning margin|marge du vainqueur|ecart entre [eé]quipes|ecart de buts/i.test(m)) {
    // N+ AVANT N pour eviter que "home by 2+" soit capture par "home by (\d+)" exact
    if (/home by (\d+)\+/i.test(s)) { const n = parseInt(RegExp.$1); return maskFromPredicate((h,a) => h - a >= n); }
    if (/home by (\d+)/i.test(s)) { const n = parseInt(RegExp.$1); return maskFromPredicate((h,a) => h - a === n); }
    if (/away by (\d+)\+/i.test(s)) { const n = parseInt(RegExp.$1); return maskFromPredicate((h,a) => a - h >= n); }
    if (/away by (\d+)/i.test(s)) { const n = parseInt(RegExp.$1); return maskFromPredicate((h,a) => a - h === n); }
    if (/match nul|draw|nul/i.test(s)) return maskFromPredicate((h,a) => h === a);
    // Format CongoBet FR : "1 / >2", "2 / =1", "x / <3"
    const frMatch = s.match(/^([12x])\s*\/\s*([><=])\s*(\d+)$/i);
    if (frMatch) {
      const [, side, op, nStr] = frMatch;
      const n = parseInt(nStr);
      const diff = (h, a) => side === '1' ? h - a : (side === '2' ? a - h : 0);
      if (op === '>') return maskFromPredicate((h,a) => diff(h,a) > n);
      if (op === '=') return maskFromPredicate((h,a) => diff(h,a) === n);
      if (op === '<') return maskFromPredicate((h,a) => diff(h,a) < n);
    }
    // Format CongoBet FR handicap : "1 (+0.5)", "2 (-1.5)", "x (+0.5)"
    const hcpMatch = s.match(/^([12x])\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*\)$/i);
    if (hcpMatch) {
      const [, side, hcpStr] = hcpMatch;
      const hcp = parseFloat(hcpStr);
      if (isQuarterLine(hcp)) { _quarterLineSkipped++; return null; }
      if (side === '1') return maskFromPredicate((h,a) => (h - a) + hcp > 0);
      if (side === '2') return maskFromPredicate((h,a) => (a - h) + hcp > 0);
      if (side.toLowerCase() === 'x') return maskFromPredicate((h,a) => Math.abs(h - a) + hcp === 0);
      return null;
    }
    // Format BetPawa EN : "Home by 1", "Away by 2+", "No Goal / Draw"
    if (/no goal|scoreless/i.test(s)) return maskFromPredicate((h,a) => h === 0 && a === 0);
    _skippedWinMargin.add(`[${m}] → "${s}"`);
    return null;
  }

  // FIX #1 : marches COMBINES (X & Y, X/Y) — decompose et intersect les masks
  const combined = trySplitCombined(m, s);
  if (combined) return combined;

  // ─ Correct Score
  if (/correct score|score exact|^score$/i.test(m)) {
    const mm = s.match(/^(\d+)\s*[:\-]\s*(\d+)$/);
    if (mm) return cellBit(parseInt(mm[1]), parseInt(mm[2]));
    // "Any Other Home Win" etc.
    if (/any other home|autre score victoire domicile/i.test(s)) return maskFromPredicate((h,a) => h > a && (h >= 4 || a >= 3)); // au-dela
    if (/any other away|autre score victoire ext/i.test(s)) return maskFromPredicate((h,a) => a > h && (a >= 4 || h >= 3));
    if (/any other draw|autre score nul/i.test(s)) return maskFromPredicate((h,a) => h === a && h >= 3);
    return null;
  }

  // ─ 1X2 Basic / Match Result
  const isBasic1x2 = /^(1x2|1x2 - ft|basic offer|match result|r[eé]sultat du match|full time result|full time result \(regular time\)|result|match winner)$/i.test(m);
  if (isBasic1x2) {
    if (/^(home|1|w1)$/i.test(s)) return maskFromPredicate((h,a) => h > a);
    if (/^(draw|x)$/i.test(s)) return maskFromPredicate((h,a) => h === a);
    if (/^(away|2|w2)$/i.test(s)) return maskFromPredicate((h,a) => a > h);
    return null;
  }

  // ─ Double Chance
  if (/^double chance/i.test(m)) {
    // Attention : certains books ecrivent le nom de l'equipe ("Draw Or 12 de
    // Octubre Itaugua"). Chercher "12" dans ce texte donnait un DC 12 au lieu
    // d'un DC X2 -> faux surebets. On resout donc par les noms d'equipes,
    // et on refuse la cote si elle reste ambigue.
    const sc = s.trim();
    if (/^(1x|1 ?- ?x)$/i.test(sc) || /home\/draw|home or draw|draw or home/i.test(sc)) return maskFromPredicate((h,a) => h >= a);
    if (/^(x2|x ?- ?2)$/i.test(sc) || /draw\/away|draw or away|away or draw/i.test(sc)) return maskFromPredicate((h,a) => a >= h);
    if (/^(12|1 ?- ?2)$/i.test(sc) || /home\/away|home or away/i.test(sc)) return maskFromPredicate((h,a) => h !== a);
    if (/draw|nul/i.test(sc)) {
      const withHome = isHomeTeamInMarket(sc, homeTeam, awayTeam);
      const withAway = isAwayTeamInMarket(sc, homeTeam, awayTeam);
      if (withHome && !withAway) return maskFromPredicate((h,a) => h >= a);
      if (withAway && !withHome) return maskFromPredicate((h,a) => a >= h);
      return null;
    }
    const onlyHome = isHomeTeamInMarket(sc, homeTeam, awayTeam) && !isAwayTeamInMarket(sc, homeTeam, awayTeam);
    const onlyAway = isAwayTeamInMarket(sc, homeTeam, awayTeam) && !isHomeTeamInMarket(sc, homeTeam, awayTeam);
    if (onlyHome && onlyAway) return null;
    return null;
  }

  // ─ Draw No Bet
  if (/^draw no bet/i.test(m) || /victoire d'une des deux/i.test(m)) {
    if (/^1$|^home$/i.test(s)) return maskFromPredicate((h,a) => h > a);
    if (/^2$|^away$/i.test(s)) return maskFromPredicate((h,a) => a > h);
    return null;
  }

  // ─ BTTS (both teams to score)
  // Test ANCRE : "Both teams to score in both halves" ou "1st half. Both teams
  // to score" dependent des scores de mi-temps, pas de la grille temps plein.
  // Les traiter comme un BTTS simple fabriquait de faux surebets (~48%).
  if (/^(both teams to score|btts|les deux [eé]quipes marquent|gg\/ng|goal ?\/ ?no ?goal)(?: -? ?ft)?$/i.test(m)) {
    if (/^(yes|oui|gg)$/i.test(s.trim())) return maskFromPredicate((h,a) => h >= 1 && a >= 1);
    if (/^(no|non|ng)$/i.test(s.trim())) return maskFromPredicate((h,a) => h === 0 || a === 0);
    return null;
  }

  // ─ Over/Under totaux match (Total goals X.Y ou Over/Under X.Y)
  const totalLineMatch = m.match(/(?:total goals?|nombre de buts|over\/under|total score over\/under - ft|^total)\s*\[?([\d.]+)\]?/i);
  if (totalLineMatch || /^over\/under|^nombre de buts$|^total goals|^total$|^total score over\/under - ft$/i.test(m)) {
    // Chercher line dans market OU dans selection
    let line = totalLineMatch ? parseFloat(totalLineMatch[1]) : NaN;
    if (isNaN(line)) {
      const selLine = s.match(/(?:over|under|plus|moins|>|<)\s*(?:de\s*)?([\d.]+)/i);
      if (selLine) line = parseFloat(selLine[1]);
    }
    if (!isNaN(line)) {
      if (isQuarterLine(line)) { _quarterLineSkipped++; return null; }
      if (/over|plus|>/i.test(s)) return maskFromPredicate((h,a) => (h + a) > line);
      if (/under|moins|</i.test(s)) return maskFromPredicate((h,a) => (h + a) < line);
    }
    return null;
  }

  // ─ Multigoals (SportyBet, Apollo, Congobet, BetPawa)
  if (/multigoal/i.test(m)) {
    const mgHome = /home|domicile/i.test(m);
    const mgAway = /away|ext[eé]rieur/i.test(m);
    const goalFn = mgHome ? (h,_a) => h : (mgAway ? (_h,a) => a : (h,a) => h + a);
    if (/^0$/.test(s)) {
      if (mgHome) return maskFromPredicate((h,_a) => h === 0);
      if (mgAway) return maskFromPredicate((_h,a) => a === 0);
      return cellBit(0, 0);
    }
    const rangeMatch = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1]);
      const hi = parseInt(rangeMatch[2]);
      return maskFromPredicate((h,a) => goalFn(h,a) >= lo && goalFn(h,a) <= hi);
    }
    const plusMatch = s.match(/^(\d+)\+$/);
    if (plusMatch) return maskFromPredicate((h,a) => goalFn(h,a) >= parseInt(plusMatch[1]));
    return null;
  }

  // ─ Handicap Européen (0:1, 1:0, 0:2, etc.)
  const hcpEurMatch = m.match(/handicap\s*(?:européen|europ|goals|1x2 - ft)?\s*(\d+):(\d+)/i);
  if (hcpEurMatch) {
    const [hh, aa] = [parseInt(hcpEurMatch[1]), parseInt(hcpEurMatch[2])];
    if (/^1$/i.test(s) || /^home$/i.test(s)) return maskFromPredicate((h,a) => (h + hh) > (a + aa));
    if (/^x$/i.test(s) || /^draw$/i.test(s)) return maskFromPredicate((h,a) => (h + hh) === (a + aa));
    if (/^2$/i.test(s) || /^away$/i.test(s)) return maskFromPredicate((h,a) => (a + aa) > (h + hh));
    return null;
  }

  // ─ Handicap 1X2 / European Handicap with [N] format (BetPawa: "Handicap 1X2 - FT [3]")
  // Three-way market (1/X/2) — must be checked BEFORE Asian Handicap
  const hcp1x2Match = m.match(/handicap\s*1x2[^[]*\[\s*(-?[\d.]+)\s*\]/i);
  if (hcp1x2Match) {
    const line = parseFloat(hcp1x2Match[1]);
    if (/^1$/i.test(s) || /^home$/i.test(s)) return maskFromPredicate((h,a) => (h + line) > a);
    if (/^x$/i.test(s) || /^draw$/i.test(s) || /^nul/i.test(s)) return maskFromPredicate((h,a) => (h + line) === a);
    if (/^2$/i.test(s) || /^away$/i.test(s)) return maskFromPredicate((h,a) => a > (h + line));
    return null;
  }

  // ─ Asian Handicap (line ±X.5 ou ±X) via [Y] dans market ou handicap nu (1win)
  const ahMatch = m.match(/(?:handicap|asian handicap)[^[]*\[\s*(-?[\d.]+)\s*\]/i);
  if (ahMatch) {
    const line = parseFloat(ahMatch[1]);
    if (isQuarterLine(line)) { _quarterLineSkipped++; return null; }
    if (/^1|home/i.test(s)) return maskFromPredicate((h,a) => (h + line) > a);
    if (/^2|away/i.test(s)) return maskFromPredicate((h,a) => a > (h + line));
    return null;
  }
  if (/^handicap$/i.test(m)) {
    const lineMatch = s.match(/(-?\d+(?:\.\d+)?)/);
    if (lineMatch) {
      const line = parseFloat(lineMatch[1]);
      if (isQuarterLine(line)) { _quarterLineSkipped++; return null; }
      const isW1 = /^1\b|^w1\b|^home\b/i.test(s);
      const isW2 = /^2\b|^w2\b|^away\b/i.test(s);
      if (isW1) return maskFromPredicate((h,a) => (h + line) > a);
      if (isW2) return maskFromPredicate((h,a) => (a + line) > h);
      const awayInSel = awayTeam && teamMatchScore(s, awayTeam) >= 0.5;
      const homeInSel = homeTeam && teamMatchScore(s, homeTeam) >= 0.5;
      if (homeInSel && !awayInSel) return maskFromPredicate((h,a) => (h + line) > a);
      if (awayInSel && !homeInSel) return maskFromPredicate((h,a) => (a + line) > h);
    }
    return null;
  }

  // ─ Team totals Home (Team 1 Total [X.Y] / nombre de buts de HOME / total score O/U home)
  // Total d'une equipe designee par son NOM (et non par "team 1/2").
  const hasNamedTeamTotal = /\btotal\b/i.test(m)
    && (isHomeTeamInMarket(m, homeTeam, awayTeam) || isAwayTeamInMarket(m, homeTeam, awayTeam));
  const hasFrenchTeamTotal = /nombre de buts de\s|total de buts de\s/i.test(m) || hasNamedTeamTotal;
  const teamTotalIsAway = hasFrenchTeamTotal
    ? (/away|ext[eé]rieur|team 2/i.test(m) || isAwayTeamInMarket(m, homeTeam, awayTeam))
    : false;
  const isHomeTotal = (!teamTotalIsAway && (hasFrenchTeamTotal || /team 1 total|total score over\/under - ft - home team/i.test(m)))
    && !/away|ext[eé]rieur|team 2/i.test(m);
  if (isHomeTotal) {
    let line = NaN;
    const lm = m.match(/\[\s*([\d.]+)\s*\]/);
    if (lm) line = parseFloat(lm[1]);
    if (isNaN(line)) { const sl = s.match(/([\d.]+)/); if (sl) line = parseFloat(sl[1]); }
    if (!isNaN(line)) {
      if (isQuarterLine(line)) { _quarterLineSkipped++; return null; }
      if (/over|plus|>/i.test(s)) return maskFromPredicate((h,_a) => h > line);
      if (/under|moins|</i.test(s)) return maskFromPredicate((h,_a) => h < line);
    }
    return null;
  }
  // ─ Team totals Away (Team 2 Total [X.Y] / nombre de buts de AWAY)
  const isAwayTotal = /team 2 total|total score over\/under - ft - away team/i.test(m)
    || teamTotalIsAway;
  if (isAwayTotal) {
    let line = NaN;
    const lm = m.match(/\[\s*([\d.]+)\s*\]/);
    if (lm) line = parseFloat(lm[1]);
    if (isNaN(line)) { const sl = s.match(/([\d.]+)/); if (sl) line = parseFloat(sl[1]); }
    if (!isNaN(line)) {
      if (isQuarterLine(line)) { _quarterLineSkipped++; return null; }
      if (/over|plus|>/i.test(s)) return maskFromPredicate((_h,a) => a > line);
      if (/under|moins|</i.test(s)) return maskFromPredicate((_h,a) => a < line);
    }
    return null;
  }
  // ─ Exact team goals (CongoBet: "nombre exact de buts inscrits par X")
  if (/nombre exact de buts inscrits par/i.test(m)) {
    const isAway = isAwayTeamInMarket(m, homeTeam, awayTeam);
    const nMatch = s.match(/^(\d+)$/);
    if (nMatch) {
      const n = parseInt(nMatch[1]);
      return isAway ? maskFromPredicate((_h,a) => a === n) : maskFromPredicate((h,_a) => h === n);
    }
    if (/^(\d+)\+$/.test(s)) {
      const n = parseInt(RegExp.$1);
      return isAway ? maskFromPredicate((_h,a) => a >= n) : maskFromPredicate((h,_a) => h >= n);
    }
    return null;
  }

  // ─ Nombre exact de buts total (Congobet)
  if (/^nombre exact de buts$|^exact (?:number of )?goals$/i.test(m)) {
    const nMatch = s.match(/^(\d+)$/);
    if (nMatch) return maskFromPredicate((h,a) => (h + a) === parseInt(nMatch[1]));
    if (/^(\d+)\+$/.test(s)) { const n = parseInt(RegExp.$1); return maskFromPredicate((h,a) => (h + a) >= n); }
    return null;
  }

  // ─ Odd/Even (total, home, ou away)
  if (/odd\s*\/\s*even/i.test(m)) {
    const oeHome = /home|domicile|team\s*1|1st\s*team|[eé]quipe\s*1/i.test(m)
      || (!(/away|ext[eé]rieur|team\s*2|2nd\s*team|[eé]quipe\s*2/i.test(m)) && isHomeTeamInMarket(m, homeTeam, awayTeam));
    const oeAway = /away|ext[eé]rieur|team\s*2|2nd\s*team|[eé]quipe\s*2/i.test(m)
      || (!oeHome && isAwayTeamInMarket(m, homeTeam, awayTeam));
    const goalFn = oeHome ? (h, _a) => h : (oeAway ? (_h, a) => a : (h, a) => h + a);
    if (/odd|impair/i.test(s)) return maskFromPredicate((h,a) => goalFn(h,a) % 2 === 1);
    if (/even|pair/i.test(s)) return maskFromPredicate((h,a) => goalFn(h,a) % 2 === 0);
    return null;
  }

  // ─ Clean Sheet pur : l'equipe designee n'encaisse aucun but.
  if (/clean sheet|n'encaisse pas de but/i.test(m) && !/ ou /i.test(m) && !/win to nil/i.test(m)) {
    const yes = /^(yes|oui)$/i.test(s.trim()), no = /^(no|non)$/i.test(s.trim());
    if (!yes && !no) return null;
    const isHome = /home|domicile/i.test(m) || isHomeTeamInMarket(m, homeTeam, awayTeam);
    const isAway = /away|ext[eé]rieur/i.test(m) || isAwayTeamInMarket(m, homeTeam, awayTeam);
    if (isHome === isAway) return null; // cote non attribuable a une equipe
    if (isHome) return maskFromPredicate((h,a) => (yes ? a === 0 : a > 0));
    return maskFromPredicate((h,a) => (yes ? h === 0 : h > 0));
  }

  // ─ Clean Sheet / Win to Nil : DEUX marches distincts, ne pas confondre.
  //   "Clean Sheet Home"  = l'adversaire ne marque pas          -> a === 0
  //   "Home to Win to Nil"= gagne ET l'adversaire ne marque pas -> h > 0 && a === 0
  //   Les confondre laissait le 0-0 a decouvert (faux surebets ~5-6%).
  if (/to win to nil|win to nil|gagne sans encaisser/i.test(m) && !/ ou /i.test(m)) {
    if (/home|domicile/i.test(m)) {
      if (/yes|oui|^1$/i.test(s)) return maskFromPredicate((h,a) => h > 0 && a === 0);
      if (/no|non|^2$/i.test(s)) return maskFromPredicate((h,a) => !(h > 0 && a === 0));
      return null;
    }
    if (/away|ext[eé]rieur/i.test(m)) {
      if (/yes|oui|^1$/i.test(s)) return maskFromPredicate((h,a) => a > 0 && h === 0);
      if (/no|non|^2$/i.test(s)) return maskFromPredicate((h,a) => !(a > 0 && h === 0));
      return null;
    }
    const awayInMarket = isAwayTeamInMarket(m, homeTeam, awayTeam);
    if (awayInMarket) {
      if (/yes|oui/i.test(s)) return maskFromPredicate((h,a) => a > 0 && h === 0);
      if (/no|non/i.test(s)) return maskFromPredicate((h,a) => !(a > 0 && h === 0));
      return null;
    }
    if (isHomeTeamInMarket(m, homeTeam, awayTeam)) {
      if (/yes|oui/i.test(s)) return maskFromPredicate((h,a) => h > 0 && a === 0);
      if (/no|non/i.test(s)) return maskFromPredicate((h,a) => !(h > 0 && a === 0));
      return null;
    }
    if (/yes|oui/i.test(s)) return maskFromPredicate((h,a) => (h > 0 && a === 0) || (a > 0 && h === 0));
    if (/no|non/i.test(s)) return maskFromPredicate((h,a) => !((h > 0 && a === 0) || (a > 0 && h === 0)));
    if (/^home$|^1$/i.test(s)) return maskFromPredicate((h,a) => h > 0 && a === 0);
    if (/^away$|^2$/i.test(s)) return maskFromPredicate((h,a) => a > 0 && h === 0);
    return null;
  }

  return null;
}

// ─── Extracteurs ───────────────────────────────────────────────────────────
function extract_sportybet(raw) {
  const out = [];
  const markets = raw?.data?.markets || raw?.markets || [];
  for (const m of markets) {
    const marketName = m.name || `market-${m.id}`;
    const spec = m.specifier ? ` [${m.specifier}]` : '';
    for (const o of m.outcomes || []) {
      const c = parseFloat(o.odds);
      if (isNaN(c) || c <= 1) continue;
      out.push({ market: String(marketName), selection: `${o.desc || '?'}${spec}`, odds: c });
    }
  }
  return out;
}
function extract_apollo(raw) {
  const out = [];
  for (const o of raw?.Offers || []) {
    const marketName = o.Description || `bettype-${o.BetTypeKey}`;
    const sbv = o.Sbv ? ` [${o.Sbv}]` : '';
    for (const od of o.Odds || []) {
      const c = parseFloat(od.Odd);
      if (isNaN(c) || c <= 1) continue;
      out.push({ market: String(marketName), selection: `${od.Name || od.Type || '?'}${sbv}`, odds: c });
    }
  }
  return out;
}
function extract_congobet(raw) {
  const out = [];
  for (const bt of raw?.eventBetTypes || []) {
    const marketName = bt.name || '?';
    for (const it of bt.eventBetTypeItems || []) {
      const c = parseFloat(it.odds);
      if (isNaN(c) || c <= 1) continue;
      out.push({ market: String(marketName), selection: String(it.shortName || it.name || '?'), odds: c });
    }
  }
  return out;
}
function extract_betpawa(raw) {
  const out = [];
  for (const mk of raw?.markets || []) {
    const marketName = mk.marketType?.name || mk.name || `m${mk.id}`;
    for (const row of (mk.row || [])) {
      const spec = row?.specifier || {};
      const lineSuffix = spec.total ? ` [${spec.total}]` : (spec.hcp ? ` [${spec.hcp}]` : '');
      for (const p of (row.prices || [])) {
        const c = parseFloat(p.odds);
        if (isNaN(c) || c <= 1) continue;
        out.push({ market: `${marketName}${lineSuffix}`, selection: String(p.name || p.displayName || '?'), odds: c });
      }
    }
  }
  return out;
}

const XBET_TYPE_NAMES = {
  1: 'Home', 2: 'Draw', 3: 'Away',
  4: '1X', 5: '12', 6: 'X2',
  7: 'Home', 8: 'Away',
  9: 'Over', 10: 'Under',
  11: 'Over', 12: 'Under', 13: 'Over', 14: 'Under',
  180: 'Yes', 181: 'No',
  182: 'Even', 183: 'Odd',
  703: 'Home', 704: 'Away',
  923: 'Home', 924: 'Away', 925: 'No Goal',
  1305: '1st Half', 1306: '2nd Half', 1307: 'Equal',
};
const XBET_GROUP_MAP = {
  1: 'Match Result', 8: 'Double Chance', 17: 'Over/Under',
  19: 'Both Teams To Score', 2: 'Handicap', 14: 'Odd/Even',
  9: 'Draw No Bet', 169: 'First Team To Score',
  15: 'Team 1 Total', 62: 'Team 2 Total', 445: 'Half With Most Goals',
  11581: 'Match Result',
  // Groupes football additionnels (dérivés des APIs 1xBet)
  27: 'Correct Score',
  21: 'Winning Margin',
  20: 'Exact Goals',
  28: 'Double Chance HT',
  30: 'Over/Under HT',
  31: 'BTTS HT',
  37: 'HT/FT',
  43: 'Handicap HT',
  111: 'Race To X Goals',
  114: 'Score in Both Halves',
  118: 'Win Both Halves',
  119: 'Win Either Half',
  127: 'Clean Sheet Home',
  128: 'Clean Sheet Away',
  129: 'Win To Nil Home',
  130: 'Win To Nil Away',
  136: 'Multigoals',
  237: 'Asian Handicap',
  1845: 'European Handicap',
};
function extract_1xbet(raw) {
  const out = [];
  const GE = raw?.Value?.GE || [];
  for (const ge of GE) {
    const groupName = XBET_GROUP_MAP[ge.G] || ge.GN || `G${ge.G}`;
    if (!ge.E) continue;
    for (const sub of ge.E) {
      for (const it of (Array.isArray(sub) ? sub : [sub])) {
        if (it?.C == null) continue;
        const c = parseFloat(it.C);
        if (isNaN(c) || c <= 1) continue;
        let sel = it.N || XBET_TYPE_NAMES[it.T] || `T${it.T}`;
        if (it.P != null && (it.T === 9 || it.T === 10 || it.T === 11 || it.T === 12 || it.T === 13 || it.T === 14)) {
          sel = `${sel} ${it.P}`;
        }
        if (it.P != null && (it.T === 7 || it.T === 8)) {
          sel = `${sel} (${it.P > 0 ? '+' : ''}${it.P})`;
        }
        out.push({ market: groupName, selection: sel, odds: c });
      }
    }
  }
  return out;
}
async function fetch1xbetSubgames(raw) {
  const out = [];
  const SG = raw?.Value?.SG || [];
  for (const sg of SG) {
    const pn = (sg.PN || '').toLowerCase();
    if (!/score exact|correct score/i.test(pn)) continue;
    const sid = sg.I;
    if (!sid) continue;
    try {
      const sd = await viaWorker(`${FEED}/service-api/LineFeed/GetGameZip?id=${sid}&lng=fr&isSubGames=false&GroupEvents=true&countevents=250&grMode=4&country=${COUNTRY}&marketType=1&isNewBuilder=true`);
      const GEsub = sd?.Value?.GE || [];
      for (const ge of GEsub) {
        if (!ge.E) continue;
        for (const sub of ge.E) {
          for (const it of (Array.isArray(sub) ? sub : [sub])) {
            if (it?.C == null) continue;
            const c = parseFloat(it.C);
            if (isNaN(c) || c <= 1) continue;
            // FIX D : skip si nom absent (Correct Score requiert format "N:M")
            if (!it.N || !/^\d+\s*[:\-]\s*\d+$/.test(String(it.N).trim())) continue;
            out.push({ market: 'Correct Score', selection: String(it.N).trim(), odds: c });
          }
        }
      }
    } catch {}
  }
  return out;
}
function extract_1win(raw) {
  const out = [];
  for (const [groupName, oddsList] of Object.entries(raw || {})) {
    for (const o of oddsList || []) {
      if (!o || o.status !== 1) continue;
      const c = Number(o.cf);
      if (isNaN(c) || c <= 1) continue;
      out.push({ market: groupName, selection: String(o.name || o.outcome || '?'), odds: c });
    }
  }
  return out;
}

async function fetchRawFor(bookKey, matchId) {
  try {
    if (bookKey === 'betpawa') return await bpFetchEvent(matchId, 15_000);
    if (bookKey === 'sportybet') return await sbFetchEvent(matchId, { live: false });
    if (bookKey === 'apollo') return await apolloGet(`/sport/offer/v3/match/offers?MatchId=${matchId}`);
    if (bookKey === 'congobet') return await congoJson(`${CONGO_API}events/${matchId}`);
    if (bookKey === '1xbet') {
      const url = `${FEED}/service-api/LineFeed/GetGameZip?id=${matchId}&lng=fr&isSubGames=true&GroupEvents=true&countevents=2000&grMode=4&country=${COUNTRY}&marketType=1&isNewBuilder=true`;
      return await viaWorker(url);
    }
    if (bookKey === '1win') {
      const raw = await fetchOddsWS([matchId], { timeoutMs: 20000, quietMs: 3000 });
      return raw.get(matchId) || raw.get(String(matchId)) || {};
    }
  } catch { return null; }
  return null;
}
const EXTRACTORS = {
  sportybet: extract_sportybet, apollo: extract_apollo, congobet: extract_congobet,
  betpawa: extract_betpawa, '1xbet': extract_1xbet, '1win': extract_1win,
};
async function extractWithSubgames(bookKey, raw) {
  const base = EXTRACTORS[bookKey] ? EXTRACTORS[bookKey](raw) : [];
  if (bookKey === '1xbet') {
    const sgOuts = await fetch1xbetSubgames(raw);
    base.push(...sgOuts);
  }
  return base;
}

// ─── Enumeration & solveur ─────────────────────────────────────────────────
// Regroupe les outcomes par bitmask → { mask: { book: bestOdds } } puis {mask: [{book, odds}]}
function groupByMask(outcomes) {
  const groups = new Map(); // maskStr → { mask, byBook: Map<book, bestEntry> }
  for (const o of outcomes) {
    const mask = classifyOutcome(o);
    if (!mask) { _nullCount++; continue; }
    if (mask === 0n || mask === ALL_CELLS_MASK) { _trivialCount++; continue; }
    const key = mask.toString(16);
    if (!groups.has(key)) groups.set(key, { mask, byBook: new Map() });
    const g = groups.get(key);
    const prev = g.byBook.get(o.book);
    if (!prev || o.odds > prev.odds) g.byBook.set(o.book, o);
  }
  const uniq = [];
  for (const g of groups.values()) {
    for (const entry of g.byBook.values()) {
      uniq.push({ mask: g.mask, book: entry.book, market: entry.market, selection: entry.selection, odds: entry.odds });
    }
  }
  return uniq;
}

// FIX #3 : rejette les combos avec chevauchement (2 picks couvrant meme cellule)
// Sans quoi 1-sumInv n'est PAS le vrai profit garanti mais une surassurance.
function areDisjoint(picks) {
  let cumul = 0n;
  for (const p of picks) {
    if ((cumul & p.mask) !== 0n) return false;
    cumul |= p.mask;
  }
  return true;
}

// FIX #10 : LIM=80 supprime — enumeration complete 2..4 items.
function findCoverageSets(items, minProfit) {
  const arr = items.slice().sort((a, b) => Number(popcount(b.mask) - popcount(a.mask)));
  const N = arr.length;
  const opps = [];
  const record = (picks, sumInv) => {
    if (REQUIRE_DISJOINT && !areDisjoint(picks)) return;
    const books = new Set(picks.map(p => p.book));
    if (books.size < 2) return;
    opps.push({ picks, profit: 1 - sumInv, sumInv, size: picks.length });
  };

  for (let i = 0; i < N; i++) {
    const inv1 = 1 / arr[i].odds;
    if (inv1 >= 1 - minProfit) continue;
    for (let j = i + 1; j < N; j++) {
      const inv2 = inv1 + 1 / arr[j].odds;
      if (inv2 >= 1 - minProfit) continue;
      const m2 = arr[i].mask | arr[j].mask;
      if (m2 === ALL_CELLS_MASK) record([arr[i], arr[j]], inv2);
      for (let k = j + 1; k < N; k++) {
        const inv3 = inv2 + 1 / arr[k].odds;
        if (inv3 >= 1 - minProfit) continue;
        const m3 = m2 | arr[k].mask;
        if (m3 === ALL_CELLS_MASK) record([arr[i], arr[j], arr[k]], inv3);
        for (let l = k + 1; l < N; l++) {
          const inv4 = inv3 + 1 / arr[l].odds;
          if (inv4 >= 1 - minProfit) continue;
          const m4 = m3 | arr[l].mask;
          if (m4 === ALL_CELLS_MASK) record([arr[i], arr[j], arr[k], arr[l]], inv4);
        }
      }
    }
  }
  return opps;
}

// FIX #1 : calcule les mises pour bankroll donnee
function computeStakes(picks, bankroll) {
  const sumInv = picks.reduce((s, p) => s + 1 / p.odds, 0);
  const stakes = picks.map(p => (bankroll / p.odds) / sumInv);
  const total = stakes.reduce((a, b) => a + b, 0);
  const retour = bankroll / sumInv;
  return { stakes, total, retour, gainNet: retour - total, roi: (retour - total) / total };
}

function popcount(bi) {
  let n = 0n;
  while (bi > 0n) { n += bi & 1n; bi >>= 1n; }
  return n;
}

// ─── Main ──────────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════');
console.log('  SOLVEUR COMBINATOIRE — coverage sets multi-books multi-markets');
console.log(`  Books analyses : ${BOOKS.join(', ')}`);
console.log(`  Seuil profit : ${(MIN_PROFIT*100).toFixed(0)}%   Top ${TOP_MATCHES} matchs`);
console.log('═══════════════════════════════════════════════════════════════\n');

const t0 = Date.now();

const catalogs = new Map();
for (const key of BOOKS) {
  const book = bookmakersByKey[key];
  if (!book) continue;
  try {
    const matches = await book.listMatches({ live: false, sport: 'football', horizonHours: 30 });
    catalogs.set(key, matches);
    console.log(`[${key}] ${matches.length} matchs listes`);
  } catch (e) { console.log(`[${key}] KO ${e.message}`); }
}

const entries = alignCatalogs(catalogs, { minBooks: 3, horizonMs: Date.now() + 48 * 3600 * 1000 });
entries.sort((a, b) => Object.keys(b.matches).length - Object.keys(a.matches).length);
const top = entries.slice(0, TOP_MATCHES);
console.log(`\n${top.length} matchs top selectionnes\n`);

const allOpps = [];

for (const entry of top) {
  console.log(`\n▓▓ ${entry.ref.home} vs ${entry.ref.away} — ${Object.keys(entry.matches).length} books`);
  // FIX #9 : fetch parallele par book
  const bookMatches = Object.entries(entry.matches).filter(([b]) => EXTRACTORS[b]);
  const rawResults = await Promise.all(bookMatches.map(async ([book, m]) => {
    try { return { book, raw: await fetchRawFor(book, m.id) }; }
    catch (e) { return { book, raw: null, err: e.message }; }
  }));
  const outcomes = [];
  for (const { book, raw, err } of rawResults) {
    if (!raw) { console.log(`  [${book}] raw KO ${err || ''}`); continue; }
    const bookOuts = (await extractWithSubgames(book, raw)).map(o => ({ ...o, book, homeTeam: entry.ref.home, awayTeam: entry.ref.away }));
    console.log(`  [${book}] ${bookOuts.length} outcomes`);
    outcomes.push(...bookOuts);
  }
  console.log(`  → TOTAL ${outcomes.length} outcomes cross-book`);

  // Classifie + regroupe
  _classifiedCount = 0; _nullCount = 0; _trivialCount = 0; _quarterLineSkipped = 0;
  const items = groupByMask(outcomes);
  _classifiedCount = items.length;
  const uniqueMasks = new Set(items.map(i => i.mask.toString(16))).size;
  console.log(`  → CLASSIF: ${uniqueMasks} masks uniques, ${_classifiedCount} items (mask×book), ${_nullCount} null, ${_trivialCount} triviaux, ${_quarterLineSkipped} quarter-line skippés`);
  console.log(`  → Taux classification: ${outcomes.length ? ((outcomes.length - _nullCount) / outcomes.length * 100).toFixed(1) : 0}%`);

  // Cherche coverage sets
  const opps = findCoverageSets(items, MIN_PROFIT);
  console.log(`  → ${opps.length} coverage sets rentables (>= ${(MIN_PROFIT*100).toFixed(0)}%)`);
  for (const o of opps) {
    allOpps.push({ ...o, match: `${entry.ref.home} vs ${entry.ref.away}` });
  }

  // DIAGNOSTIC : top 5 meilleures couvertures partielles (2-items) multi-book
  if (opps.length === 0 && items.length >= 2) {
    const arr = items.slice().sort((a, b) => Number(popcount(b.mask) - popcount(a.mask)));
    const partials = [];
    const LIM2 = Math.min(arr.length, 60);
    for (let i = 0; i < LIM2 && partials.length < 5; i++) {
      for (let j = i + 1; j < LIM2 && partials.length < 5; j++) {
        if (arr[i].book === arr[j].book) continue;
        const union = arr[i].mask | arr[j].mask;
        const cov = Number(popcount(union));
        const pct = (cov / (GRID*GRID) * 100).toFixed(1);
        const sumInv = 1 / arr[i].odds + 1 / arr[j].odds;
        partials.push({ cov, pct, sumInv, picks: [arr[i], arr[j]] });
      }
    }
    partials.sort((a, b) => b.cov - a.cov);
    if (partials.length > 0) {
      console.log(`  ─── TOP COUVERTURES PARTIELLES (2-picks cross-book) ───`);
      for (const p of partials.slice(0, 3)) {
        const gap = GRID*GRID - p.cov;
        const profit = ((1 - p.sumInv) * 100).toFixed(1);
        console.log(`    ${p.pct}% couvert (${gap} trous) profit_theorique=${profit}%`);
        for (const pk of p.picks) {
          console.log(`      [${pk.book}] ${pk.market.slice(0,40)} → ${pk.selection.slice(0,30)} @${pk.odds.toFixed(2)} (${Number(popcount(pk.mask))} cells)`);
        }
      }
    }
  }
}

allOpps.sort((a, b) => b.profit - a.profit);

console.log(`\n═══════════════════════════════════════════════════════════════`);
console.log(`  TOP OPPORTUNITES COMBINATOIRES (${allOpps.length} au total)`);
console.log(`═══════════════════════════════════════════════════════════════\n`);
for (const [i, o] of allOpps.slice(0, 30).entries()) {
  const { stakes, total, retour, gainNet, roi } = computeStakes(o.picks, BANKROLL);
  console.log(`#${i+1} PROFIT ${(o.profit*100).toFixed(2)}%  (ROI net ${(roi*100).toFixed(2)}%, ${o.size} sel)  ${o.match}`);
  console.log(`   Bankroll ${BANKROLL.toLocaleString('fr')} XOF → mise ${total.toFixed(0)}, retour garanti ${retour.toFixed(0)}, gain net +${gainNet.toFixed(0)} XOF`);
  for (let k = 0; k < o.picks.length; k++) {
    const p = o.picks[k];
    console.log(`  • [${p.book.padEnd(10)}] ${String(p.market).slice(0, 40).padEnd(40)} → ${String(p.selection).slice(0, 30).padEnd(30)} @ ${p.odds.toFixed(2)}  mise ${stakes[k].toFixed(0)} XOF`);
  }
  console.log('');
}

if (_skippedWinMargin.size > 0) {
  console.log(`\n─── WINNING MARGIN NON CLASSIFIES (${_skippedWinMargin.size}) ───`);
  for (const m of [..._skippedWinMargin].sort()) console.log(`  ⚠ ${m}`);
}

if (_skippedMarkets.size > 0) {
  console.log(`\n─── MARCHES IGNORES (${_skippedMarkets.size} types non classifies) ───`);
  const sorted = [..._skippedMarkets].sort();
  for (const m of sorted) console.log(`  ✗ ${m}`);
}

console.log(`\nFin. Duree ${((Date.now()-t0)/1000).toFixed(1)}s`);
process.exit(0);
