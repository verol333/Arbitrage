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
const TOP_MATCHES = 5;
const MIN_PROFIT = 0.05; // 5% pour voir les plus rentables (on ajustera)
const GRID = 8; // grille scores 0..7 pour home et away = 64 cellules
const OVERFLOW_BIT = GRID * GRID; // bit 64 : "score au dela de la grille"

// ─── Score coverage : chaque outcome → bitmask sur 65 bits ────────────────
// Cellule (h, a) = bit index h*GRID + a. Bit OVERFLOW_BIT (64) = tout score
// h ≥ GRID ou a ≥ GRID.
const ALL_CELLS_MASK = ((1n << BigInt(OVERFLOW_BIT + 1)) - 1n);

function cellBit(h, a) {
  if (h >= GRID || a >= GRID) return 1n << BigInt(OVERFLOW_BIT);
  return 1n << BigInt(h * GRID + a);
}

// Construit une mask a partir d'un predicat (h,a) → bool
function maskFromPredicate(pred) {
  let m = 0n;
  for (let h = 0; h < GRID; h++) for (let a = 0; a < GRID; a++) {
    if (pred(h, a)) m |= cellBit(h, a);
  }
  // Overflow : on l'inclut si le predicat est vrai pour au moins un score "grand"
  if (pred(GRID, 0) || pred(0, GRID) || pred(GRID, GRID)) {
    m |= 1n << BigInt(OVERFLOW_BIT);
  }
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
  if (/^yes$|^oui$|^y$/.test(p)) return maskFromPredicate((h,a) => h >= 1 && a >= 1);
  if (/^no$|^non$|^n$/.test(p)) return maskFromPredicate((h,a) => h === 0 || a === 0);
  let ov = p.match(/^over\s*([\d.]+)$|^plus (?:de )?([\d.]+)$|^>\s*([\d.]+)$/);
  if (ov) { const line = parseFloat(ov[1] || ov[2] || ov[3]); return maskFromPredicate((h,a) => (h + a) > line); }
  let un = p.match(/^under\s*([\d.]+)$|^moins (?:de )?([\d.]+)$|^<\s*([\d.]+)$/);
  if (un) { const line = parseFloat(un[1] || un[2] || un[3]); return maskFromPredicate((h,a) => (h + a) < line); }
  const sc = p.match(/^(\d+)\s*[:\-]\s*(\d+)$/);
  if (sc) return cellBit(parseInt(sc[1]), parseInt(sc[2]));
  return null;
}

// Detecte les marches combines (ex: "Under 2.5 & Yes", "1/no", "Home & Over 1.5")
function trySplitCombined(market, selection) {
  let raw = selection.toLowerCase().replace(/\[[^\]]*\]/g, '').trim();
  const parts = raw.split(/\s*[&/]\s*/).map(x => x.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const masks = [];
  for (const part of parts) {
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
  /^both teams to score/i,
  /^btts/i,
  /^les deux [eé]quipes marquent/i,
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
function classifyOutcome({ market, selection, odds }) {
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
  if (/goalnr|xth goal|minsnr|match result after|when.*first goal|quand.*premier/i.test(m)) return null;
  if (/corner|carton|card|shot|foul|offside|throw/i.test(m)) return null;
  if (/first to score|first team|first goal|premier but|1er but/i.test(m)) return null;
  if (/half time with more|halftime with more|mi-temps.*plus|excluded goals/i.test(m)) return null;
  if (/multiscores/i.test(m)) return null; // trop complexes a parser (1:0, 2:0 or 3:0)
  if (/goal bounds/i.test(m)) return null; // ambigu (parfois home only, parfois away)

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
    if (/1x|home\/draw|home or draw/i.test(s)) return maskFromPredicate((h,a) => h >= a);
    if (/x2|draw\/away|draw or away/i.test(s)) return maskFromPredicate((h,a) => a >= h);
    if (/12|home\/away|home or away/i.test(s)) return maskFromPredicate((h,a) => h !== a);
    return null;
  }

  // ─ Draw No Bet
  if (/^draw no bet/i.test(m) || /victoire d'une des deux/i.test(m)) {
    if (/^1$|^home$/i.test(s)) return maskFromPredicate((h,a) => h > a);
    if (/^2$|^away$/i.test(s)) return maskFromPredicate((h,a) => a > h);
    return null;
  }

  // ─ BTTS (both teams to score)
  if (/both teams to score|btts|les deux [eé]quipes marquent|gg\/ng|goal\/no goal/i.test(m)) {
    if (/yes|oui/i.test(s)) return maskFromPredicate((h,a) => h >= 1 && a >= 1);
    if (/no|non/i.test(s)) return maskFromPredicate((h,a) => h === 0 || a === 0);
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
      if (/over|plus|>/i.test(s)) return maskFromPredicate((h,a) => (h + a) > line);
      if (/under|moins|</i.test(s)) return maskFromPredicate((h,a) => (h + a) < line);
    }
    return null;
  }

  // ─ Multigoals (SportyBet, Apollo, Congobet, BetPawa)
  if (/multigoal/i.test(m)) {
    if (/^0$/.test(s)) return cellBit(0, 0);
    const rangeMatch = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1]);
      const hi = parseInt(rangeMatch[2]);
      return maskFromPredicate((h,a) => (h + a) >= lo && (h + a) <= hi);
    }
    const plusMatch = s.match(/^(\d+)\+$/);
    if (plusMatch) return maskFromPredicate((h,a) => (h + a) >= parseInt(plusMatch[1]));
    return null;
  }

  // ─ Winning Margin (SportyBet, Congobet, BetPawa)
  if (/winning margin|marge du vainqueur|ecart entre [eé]quipes|ecart de buts/i.test(m)) {
    if (/home by (\d+)/i.test(s)) { const n = parseInt(RegExp.$1); return maskFromPredicate((h,a) => h - a === n); }
    if (/home by (\d+)\+/i.test(s)) { const n = parseInt(RegExp.$1); return maskFromPredicate((h,a) => h - a >= n); }
    if (/away by (\d+)/i.test(s)) { const n = parseInt(RegExp.$1); return maskFromPredicate((h,a) => a - h === n); }
    if (/away by (\d+)\+/i.test(s)) { const n = parseInt(RegExp.$1); return maskFromPredicate((h,a) => a - h >= n); }
    if (/match nul|draw/i.test(s)) return maskFromPredicate((h,a) => h === a);
    // Formats FR : "1 / >2" = home wins by more than 2, "1 / =1" = home wins by exactly 1
    const frMatch = s.match(/^([12x])\s*\/\s*([><=])\s*(\d+)$/i);
    if (frMatch) {
      const [, side, op, nStr] = frMatch;
      const n = parseInt(nStr);
      const diff = (h, a) => side === '1' ? h - a : (side === '2' ? a - h : 0);
      if (op === '>') return maskFromPredicate((h,a) => diff(h,a) > n);
      if (op === '=') return maskFromPredicate((h,a) => diff(h,a) === n);
      if (op === '<') return maskFromPredicate((h,a) => diff(h,a) < n);
    }
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
    if (/^1|home/i.test(s)) return maskFromPredicate((h,a) => (h + line) > a);
    if (/^2|away/i.test(s)) return maskFromPredicate((h,a) => a > (h + line));
    return null;
  }
  if (/^handicap$/i.test(m)) {
    const lineMatch = s.match(/(-?\d+(?:\.\d+)?)/);
    if (lineMatch) {
      const line = parseFloat(lineMatch[1]);
      if (/^1|home|w1/i.test(s) || s.indexOf('-') === -1) return maskFromPredicate((h,a) => (h + line) > a);
      if (/^2|away|w2/i.test(s)) return maskFromPredicate((h,a) => a > (h + line));
    }
    return null;
  }

  // ─ Team totals Home (Team 1 Total [X.Y] / nombre de buts de HOME / total score O/U home)
  const isHomeTotal = /team 1 total|total score over\/under - ft - home team|nombre de buts de\s|total de buts de\s/i.test(m)
    && !/away|ext[eé]rieur|team 2/i.test(m);
  if (isHomeTotal) {
    let line = NaN;
    const lm = m.match(/\[\s*([\d.]+)\s*\]/);
    if (lm) line = parseFloat(lm[1]);
    if (isNaN(line)) { const sl = s.match(/([\d.]+)/); if (sl) line = parseFloat(sl[1]); }
    if (!isNaN(line)) {
      if (/over|plus|>/i.test(s)) return maskFromPredicate((h,_a) => h > line);
      if (/under|moins|</i.test(s)) return maskFromPredicate((h,_a) => h < line);
    }
    return null;
  }
  // ─ Team totals Away (Team 2 Total [X.Y] / nombre de buts de AWAY)
  const isAwayTotal = /team 2 total|total score over\/under - ft - away team/i.test(m)
    || (/nombre de buts de\s|total de buts de\s/i.test(m) && /away|ext[eé]rieur|team 2/i.test(m));
  if (isAwayTotal) {
    let line = NaN;
    const lm = m.match(/\[\s*([\d.]+)\s*\]/);
    if (lm) line = parseFloat(lm[1]);
    if (isNaN(line)) { const sl = s.match(/([\d.]+)/); if (sl) line = parseFloat(sl[1]); }
    if (!isNaN(line)) {
      if (/over|plus|>/i.test(s)) return maskFromPredicate((_h,a) => a > line);
      if (/under|moins|</i.test(s)) return maskFromPredicate((_h,a) => a < line);
    }
    return null;
  }
  // ─ Exact team goals (CongoBet: "nombre exact de buts inscrits par X")
  if (/nombre exact de buts inscrits par/i.test(m)) {
    const nMatch = s.match(/^(\d+)$/);
    if (nMatch) {
      const n = parseInt(nMatch[1]);
      return maskFromPredicate((h,_a) => h === n);
    }
    if (/^(\d+)\+$/.test(s)) { const n = parseInt(RegExp.$1); return maskFromPredicate((h,_a) => h >= n); }
    return null;
  }

  // ─ Nombre exact de buts total (Congobet)
  if (/^nombre exact de buts$|^exact (?:number of )?goals$/i.test(m)) {
    const nMatch = s.match(/^(\d+)$/);
    if (nMatch) return maskFromPredicate((h,a) => (h + a) === parseInt(nMatch[1]));
    if (/^(\d+)\+$/.test(s)) { const n = parseInt(RegExp.$1); return maskFromPredicate((h,a) => (h + a) >= n); }
    return null;
  }

  // ─ Odd/Even
  if (/odd\s*\/\s*even/i.test(m)) {
    if (/odd|impair/i.test(s)) return maskFromPredicate((h,a) => (h + a) % 2 === 1);
    if (/even|pair/i.test(s)) return maskFromPredicate((h,a) => (h + a) % 2 === 0);
    return null;
  }

  // ─ Clean Sheet / Win to Nil
  if (/to win to nil|gagne sans encaisser|clean sheet|n'encaisse pas de but/i.test(m)) {
    if (/home|1|oui/i.test(s) && /home|domicile/i.test(m)) return maskFromPredicate((h,a) => h > 0 && a === 0);
    if (/away|2|oui/i.test(s) && /away|ext/i.test(m)) return maskFromPredicate((h,a) => a > 0 && h === 0);
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
            const sel = it.N || `${it.T}`;
            out.push({ market: 'Correct Score', selection: sel, odds: c });
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
  const groups = new Map(); // maskStr → { mask, entries: [{book, market, selection, odds}] }
  for (const o of outcomes) {
    const mask = classifyOutcome(o);
    if (!mask || mask === 0n || mask === ALL_CELLS_MASK) continue; // skip trivial masks
    const key = mask.toString(16);
    if (!groups.has(key)) groups.set(key, { mask, entries: [] });
    groups.get(key).entries.push(o);
  }
  // Pour chaque groupe, prend le meilleur book (odds max)
  const uniq = [];
  for (const g of groups.values()) {
    let best = null;
    for (const e of g.entries) {
      if (!best || e.odds > best.odds) best = e;
    }
    uniq.push({ mask: g.mask, book: best.book, market: best.market, selection: best.selection, odds: best.odds });
  }
  return uniq;
}

// Trouve toutes les combinaisons de 2..4 items dont mask.or = ALL_CELLS_MASK.
// Prune : commence par les items dont la mask est LA PLUS LARGE.
function findCoverageSets(items, minProfit) {
  const arr = items.slice().sort((a, b) => Number(popcount(b.mask) - popcount(a.mask)));
  const N = arr.length;
  const opps = [];

  // 2-combos
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const union = arr[i].mask | arr[j].mask;
      if (union !== ALL_CELLS_MASK) continue;
      const sumInv = 1 / arr[i].odds + 1 / arr[j].odds;
      if (sumInv < 1 - minProfit) opps.push({ picks: [arr[i], arr[j]], profit: 1 - sumInv, size: 2 });
    }
  }
  // 3-combos
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const m2 = arr[i].mask | arr[j].mask;
      const invPartial = 1 / arr[i].odds + 1 / arr[j].odds;
      if (invPartial >= 1 - minProfit) continue; // early prune
      for (let k = j + 1; k < N; k++) {
        const union = m2 | arr[k].mask;
        if (union !== ALL_CELLS_MASK) continue;
        const sumInv = invPartial + 1 / arr[k].odds;
        if (sumInv < 1 - minProfit) opps.push({ picks: [arr[i], arr[j], arr[k]], profit: 1 - sumInv, size: 3 });
      }
    }
  }
  // 4-combos (cost = O(N^4), limit N for tractability)
  const LIM = Math.min(N, 80);
  for (let i = 0; i < LIM; i++) {
    for (let j = i + 1; j < LIM; j++) {
      const inv2 = 1 / arr[i].odds + 1 / arr[j].odds;
      if (inv2 >= 1 - minProfit) continue;
      const m2 = arr[i].mask | arr[j].mask;
      for (let k = j + 1; k < LIM; k++) {
        const inv3 = inv2 + 1 / arr[k].odds;
        if (inv3 >= 1 - minProfit) continue;
        const m3 = m2 | arr[k].mask;
        for (let l = k + 1; l < LIM; l++) {
          const union = m3 | arr[l].mask;
          if (union !== ALL_CELLS_MASK) continue;
          const sumInv = inv3 + 1 / arr[l].odds;
          if (sumInv < 1 - minProfit) opps.push({ picks: [arr[i], arr[j], arr[k], arr[l]], profit: 1 - sumInv, size: 4 });
        }
      }
    }
  }
  return opps.filter(o => {
    const books = new Set(o.picks.map(p => p.book));
    return books.size >= 2;
  });
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
  const outcomes = [];
  for (const [book, m] of Object.entries(entry.matches)) {
    if (!EXTRACTORS[book]) continue;
    const raw = await fetchRawFor(book, m.id);
    if (!raw) { console.log(`  [${book}] raw KO`); continue; }
    const bookOuts = (await extractWithSubgames(book, raw)).map(o => ({ ...o, book }));
    console.log(`  [${book}] ${bookOuts.length} outcomes`);
    outcomes.push(...bookOuts);
  }
  console.log(`  → TOTAL ${outcomes.length} outcomes cross-book`);

  // Classifie + regroupe
  const items = groupByMask(outcomes);
  console.log(`  → ${items.length} masks uniques (apres dedup + best book)`);

  // Cherche coverage sets
  const opps = findCoverageSets(items, MIN_PROFIT);
  console.log(`  → ${opps.length} coverage sets rentables (>= ${(MIN_PROFIT*100).toFixed(0)}%)`);
  for (const o of opps) {
    allOpps.push({ ...o, match: `${entry.ref.home} vs ${entry.ref.away}` });
  }
}

allOpps.sort((a, b) => b.profit - a.profit);

console.log(`\n═══════════════════════════════════════════════════════════════`);
console.log(`  TOP OPPORTUNITES COMBINATOIRES (${allOpps.length} au total)`);
console.log(`═══════════════════════════════════════════════════════════════\n`);
for (const [i, o] of allOpps.slice(0, 30).entries()) {
  console.log(`#${i+1} PROFIT ${(o.profit*100).toFixed(1)}%  (${o.size} sel)  ${o.match}`);
  for (const p of o.picks) {
    console.log(`  • [${p.book.padEnd(10)}] ${p.market.slice(0, 40).padEnd(40)} → ${p.selection.slice(0, 30).padEnd(30)} @ ${p.odds.toFixed(2)}`);
  }
  console.log('');
}

if (_skippedMarkets.size > 0) {
  console.log(`\n─── MARCHES IGNORES (${_skippedMarkets.size} types non classifies) ───`);
  const sorted = [..._skippedMarkets].sort();
  for (const m of sorted) console.log(`  ✗ ${m}`);
}

console.log(`\nFin. Duree ${((Date.now()-t0)/1000).toFixed(1)}s`);
process.exit(0);
