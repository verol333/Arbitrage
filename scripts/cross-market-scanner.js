#!/usr/bin/env node
// Scanner multi-familles : cherche des arbs sur des PARTITIONS cross-market
// (differents types de marches qui couvrent 100% des issues).
//
// Familles implementees (toutes mutuellement exclusives + exhaustives) :
//   A) WTN_Home + WTN_Away + BTTS_Yes + Score_0-0  (4-way)
//   B) Exact_0 + Exact_1 + Over_1.5               (3-way)
//   C) Exact_0 + Exact_1 + Exact_2 + Over_2.5     (4-way)
//   D) CS_Home_Yes (=Away scores 0) vs Away_Total_Over_0.5 (2-way cross-market)
//   E) CS_Away_Yes (=Home scores 0) vs Home_Total_Over_0.5 (2-way cross-market)
//   F) Luzern: DC_X2 + Heur_1(0:1) + Heur_X(0:1)  (3-way)
//   G) 1H Under_0.5 vs 1H Over_0.5 cross-book      (2-way, Score_0-0_1H alt)
//   H) 1H Exact_0 + 1H Exact_1 + 1H Over_1.5       (3-way)
//   I) Odd vs Even cross-book                        (2-way)
//   J) 1H Odd vs 1H Even cross-book                 (2-way)
//   K) BTTS Yes vs BTTS No cross-book                (2-way)
//   L) 1H BTTS Yes vs 1H BTTS No                    (2-way)
//   M) Over 0.5 vs Under 0.5 cross-book             (2-way)
//   N) Over 1.5 vs Under 1.5 cross-book             (2-way)
//   O) Over 2.5 vs Under 2.5 cross-book             (2-way)
//   P) Home Over 0.5 vs Home Under 0.5 cross-book   (2-way)
//   Q) Away Over 0.5 vs Away Under 0.5 cross-book   (2-way)
//   R) 1H Over 1.5 vs 1H Under 1.5 cross-book      (2-way)
//   S) 1X2 cross-book                               (3-way)
//   T) DC 1X + Result 2 cross-market                (2-way)
//   U) DC X2 + Result 1 cross-market                (2-way)
//   V) DC 12 + Result X cross-market                (2-way)
//   W) Over 3.5 vs Under 3.5 cross-book             (2-way)
//   X) CS Home No vs Away Under 0.5 cross-market    (2-way)
//   Y) CS Away No vs Home Under 0.5 cross-market    (2-way)
//   Z) 1H 1X2 cross-book                            (3-way)
//  AA) 2H Over/Under 0.5 cross-book                 (2-way)
//  AB) 2H Over/Under 1.5 cross-book                 (2-way)
//  AC) 2H BTTS Yes/No cross-book                    (2-way)
//  AD) 2H Odd/Even cross-book                       (2-way)
//  AE) 2H 1X2 cross-book                            (3-way)
//  AF-AH) 2H DC cross-market (3 families)           (2-way)
//  AI-AK) 1H DC cross-market (3 families)           (2-way)
//  AL) Home Odd/Even cross-book                     (2-way)
//  AM) Away Odd/Even cross-book                     (2-way)
//  AN) Home Over/Under 1.5 cross-book               (2-way)
//  AO) Away Over/Under 1.5 cross-book               (2-way)
//  AP) Over/Under 4.5 cross-book                    (2-way)
//  AQ-AR) 1H Home/Away Over/Under 0.5 cross-book   (2-way)
//  AS-AT) 2H Home/Away Over/Under 0.5 cross-book   (2-way)
//  AU-AV) 2H CS cross-market                       (2-way)
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';
import { bpFetchEvent } from '../src/bookmakers/betpawa/api.js';
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { FEED, COUNTRY, viaWorker } from '../src/bookmakers/xbet/api.js';
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const BOOKS = ['1xbet', '1win', 'congobet', 'betpawa'];
const TOP_MATCHES = parseInt(process.env.TOP_MATCHES || '200', 10);
const HORIZON_H = parseInt(process.env.HORIZON_HOURS || '48', 10);
const BATCH = parseInt(process.env.MATCH_BATCH || '15', 10);

// ─── helpers ───────────────────────────────────────────────────

function parseLine(label) {
  const m = String(label).match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : NaN;
}

function isOver(label) { return /plus|over|>/i.test(label); }
function isUnder(label) { return /moins|under|</i.test(label); }

// ─── BETPAWA extraction ───────────────────────────────────────

async function extractBetpawa(matchId) {
  const raw = await bpFetchEvent(matchId, 15_000).catch(() => null);
  if (!raw) return {};
  const slots = {};
  for (const mk of raw?.markets || []) {
    const n = (mk.marketType?.name || '').trim();
    for (const row of mk.row || []) {
      const spec = row?.specifier || {};
      const specTotal = spec.total != null ? parseFloat(spec.total) : NaN;
      const specHcp = spec.hcp != null ? String(spec.hcp) : null;
      for (const p of row.prices || []) {
        const c = parseFloat(p.odds);
        if (isNaN(c) || c <= 1) continue;
        const sel = (p.name || p.displayName || '').trim();

        // 1X2 - FT
        if (n === '1X2 - FT') {
          if (sel === '1') slots.result_1 = c;
          if (sel === 'X') slots.result_X = c;
          if (sel === '2') slots.result_2 = c;
        }

        // Double Chance - FT
        if (n === 'Double Chance - FT') {
          if (sel === '1X') slots.dc_1X = c;
          if (sel === 'X2') slots.dc_X2 = c;
          if (sel === '12') slots.dc_12 = c;
        }

        // BTTS - FT
        if (n === 'Both Teams To Score - FT') {
          if (/^Oui$|^Yes$/i.test(sel)) slots.btts_yes = c;
          if (/^Non$|^No$/i.test(sel)) slots.btts_no = c;
        }

        // Win to Nil
        if (n === 'Win to Nil Home Team - FT' && /^Oui$|^Yes$/i.test(sel)) slots.wtn_home = c;
        if (n === 'Win to Nil Away Team - FT' && /^Oui$|^Yes$/i.test(sel)) slots.wtn_away = c;

        // Clean Sheet
        if (n === 'Clean Sheet Home Team - FT') {
          if (/^Oui$|^Yes$/i.test(sel)) slots.cs_home_yes = c;
          if (/^Non$|^No$/i.test(sel)) slots.cs_home_no = c;
        }
        if (n === 'Clean Sheet Away Team - FT') {
          if (/^Oui$|^Yes$/i.test(sel)) slots.cs_away_yes = c;
          if (/^Non$|^No$/i.test(sel)) slots.cs_away_no = c;
        }

        // Total Score Over/Under - FT
        // p.name might be "Plus de 0.5" or just "Plus de" (line in specifier)
        if (n === 'Total Score Over/Under - FT') {
          const nameLine = parseLine(sel);
          const line = !isNaN(nameLine) ? nameLine : specTotal;
          if (isNaN(line)) continue;
          if (isOver(sel)) {
            if (line === 0.5) slots.over_0_5 = c;
            if (line === 1.5) slots.over_1_5 = c;
            if (line === 2.5) slots.over_2_5 = c;
            if (line === 3.5) slots.over_3_5 = c;
            if (line === 4.5) slots.over_4_5 = c;
          } else if (isUnder(sel)) {
            if (line === 0.5) slots.under_0_5 = c;
            if (line === 1.5) slots.under_1_5 = c;
            if (line === 2.5) slots.under_2_5 = c;
            if (line === 3.5) slots.under_3_5 = c;
            if (line === 4.5) slots.under_4_5 = c;
          }
        }

        // Team Total Over/Under Home (FT)
        if (n === 'Total Score Over/Under - FT - Home Team') {
          const nameLine = parseLine(sel);
          const line = !isNaN(nameLine) ? nameLine : specTotal;
          if (!isNaN(line)) {
            if (isOver(sel)) {
              if (line === 0.5) slots.home_over_0_5 = c;
              if (line === 1.5) slots.home_over_1_5 = c;
            }
            if (isUnder(sel)) {
              if (line === 0.5) slots.home_under_0_5 = c;
              if (line === 1.5) slots.home_under_1_5 = c;
            }
          }
        }
        if (n === 'Total Score Over/Under - FT - Away Team') {
          const nameLine = parseLine(sel);
          const line = !isNaN(nameLine) ? nameLine : specTotal;
          if (!isNaN(line)) {
            if (isOver(sel)) {
              if (line === 0.5) slots.away_over_0_5 = c;
              if (line === 1.5) slots.away_over_1_5 = c;
            }
            if (isUnder(sel)) {
              if (line === 0.5) slots.away_under_0_5 = c;
              if (line === 1.5) slots.away_under_1_5 = c;
            }
          }
        }

        // Total Goals Exact - FT
        if (n === 'Total Goals Exact - FT') {
          if (sel === '0') slots.exact_0 = c;
          if (sel === '1') slots.exact_1 = c;
          if (sel === '2') slots.exact_2 = c;
        }

        // Correct Score 0-0
        if (/^Correct Score/i.test(n) && sel === '0:0') slots.score_0_0 = c;

        // Odd/Even
        if (n === 'Odd / Even - FT') {
          if (/^Impair$|^Odd$/i.test(sel)) slots.odd = c;
          if (/^Pair$|^Even$/i.test(sel)) slots.even = c;
        }

        // Handicap 1X2 - FT (3-way european handicap)
        if (n === 'Handicap 1X2 - FT' && specHcp === '-1') {
          if (sel === '1') slots.heur_1_01 = c;
          if (sel === 'X') slots.heur_X_01 = c;
          if (sel === '2') slots.heur_2_01 = c;
        }

        // ─── 1H markets ─────────────────────────────────
        // 1X2 - 1H
        if (n === '1X2 - 1H') {
          if (sel === '1') slots.ht_result_1 = c;
          if (sel === 'X') slots.ht_result_X = c;
          if (sel === '2') slots.ht_result_2 = c;
        }
        // EXACT match to avoid "- 1H - Home Team" / "- 1H - Away Team"
        if (n === 'Total Score Over/Under - 1H') {
          const nameLine = parseLine(sel);
          const line = !isNaN(nameLine) ? nameLine : specTotal;
          if (!isNaN(line)) {
            if (isOver(sel)) {
              if (line === 0.5) slots.ht_over_0_5 = c;
              if (line === 1.5) slots.ht_over_1_5 = c;
            }
            if (isUnder(sel)) {
              if (line === 0.5) slots.ht_under_0_5 = c;
              if (line === 1.5) slots.ht_under_1_5 = c;
            }
          }
        }
        if (n === 'Correct Score - 1H' && sel === '0:0') slots.ht_score_0_0 = c;
        if (n === 'Total Goals Exact - 1H') {
          if (sel === '0') slots.ht_exact_0 = c;
          if (sel === '1') slots.ht_exact_1 = c;
        }
        if (n === 'Both Teams To Score - 1H') {
          if (/^Oui$|^Yes$/i.test(sel)) slots.ht_btts_yes = c;
          if (/^Non$|^No$/i.test(sel)) slots.ht_btts_no = c;
        }
        if (n === 'Odd / Even - 1H') {
          if (/^Impair$|^Odd$/i.test(sel)) slots.ht_odd = c;
          if (/^Pair$|^Even$/i.test(sel)) slots.ht_even = c;
        }
        // 1H Double Chance
        if (n === 'Double Chance - 1H') {
          if (sel === '1X') slots.ht_dc_1X = c;
          if (sel === 'X2') slots.ht_dc_X2 = c;
          if (sel === '12') slots.ht_dc_12 = c;
        }
        // 1H Team Totals
        if (n === 'Total Score Over/Under - 1H - Home Team') {
          const nameLine = parseLine(sel);
          const line = !isNaN(nameLine) ? nameLine : specTotal;
          if (!isNaN(line) && line === 0.5) {
            if (isOver(sel)) slots.ht_home_over_0_5 = c;
            if (isUnder(sel)) slots.ht_home_under_0_5 = c;
          }
        }
        if (n === 'Total Score Over/Under - 1H - Away Team') {
          const nameLine = parseLine(sel);
          const line = !isNaN(nameLine) ? nameLine : specTotal;
          if (!isNaN(line) && line === 0.5) {
            if (isOver(sel)) slots.ht_away_over_0_5 = c;
            if (isUnder(sel)) slots.ht_away_under_0_5 = c;
          }
        }

        // ─── 2H markets ─────────────────────────────────
        if (n === '1X2 - 2H') {
          if (sel === '1') slots.h2_result_1 = c;
          if (sel === 'X') slots.h2_result_X = c;
          if (sel === '2') slots.h2_result_2 = c;
        }
        if (n === 'Double Chance - 2H') {
          if (sel === '1X') slots.h2_dc_1X = c;
          if (sel === 'X2') slots.h2_dc_X2 = c;
          if (sel === '12') slots.h2_dc_12 = c;
        }
        if (n === 'Both Teams To Score - 2H') {
          if (/^Oui$|^Yes$/i.test(sel)) slots.h2_btts_yes = c;
          if (/^Non$|^No$/i.test(sel)) slots.h2_btts_no = c;
        }
        if (n === 'Total Score Over/Under - 2H') {
          const nameLine = parseLine(sel);
          const line = !isNaN(nameLine) ? nameLine : specTotal;
          if (!isNaN(line)) {
            if (isOver(sel)) {
              if (line === 0.5) slots.h2_over_0_5 = c;
              if (line === 1.5) slots.h2_over_1_5 = c;
            }
            if (isUnder(sel)) {
              if (line === 0.5) slots.h2_under_0_5 = c;
              if (line === 1.5) slots.h2_under_1_5 = c;
            }
          }
        }
        if (n === 'Odd / Even - 2H') {
          if (/^Impair$|^Odd$/i.test(sel)) slots.h2_odd = c;
          if (/^Pair$|^Even$/i.test(sel)) slots.h2_even = c;
        }
        if (n === 'Clean Sheet Home Team - 2H' && /^Oui$|^Yes$/i.test(sel)) slots.h2_cs_home_yes = c;
        if (n === 'Clean Sheet Away Team - 2H' && /^Oui$|^Yes$/i.test(sel)) slots.h2_cs_away_yes = c;
        // 2H Team Totals
        if (n === 'Total Score Over/Under - 2H - Home Team') {
          const nameLine = parseLine(sel);
          const line = !isNaN(nameLine) ? nameLine : specTotal;
          if (!isNaN(line) && line === 0.5) {
            if (isOver(sel)) slots.h2_home_over_0_5 = c;
            if (isUnder(sel)) slots.h2_home_under_0_5 = c;
          }
        }
        if (n === 'Total Score Over/Under - 2H - Away Team') {
          const nameLine = parseLine(sel);
          const line = !isNaN(nameLine) ? nameLine : specTotal;
          if (!isNaN(line) && line === 0.5) {
            if (isOver(sel)) slots.h2_away_over_0_5 = c;
            if (isUnder(sel)) slots.h2_away_under_0_5 = c;
          }
        }
        // Team Odd/Even FT
        if (/^Odd \/ Even - FT.*Home/i.test(n)) {
          if (/^Impair$|^Odd$/i.test(sel)) slots.home_odd = c;
          if (/^Pair$|^Even$/i.test(sel)) slots.home_even = c;
        }
        if (/^Odd \/ Even - FT.*Away/i.test(n)) {
          if (/^Impair$|^Odd$/i.test(sel)) slots.away_odd = c;
          if (/^Pair$|^Even$/i.test(sel)) slots.away_even = c;
        }
      }
    }
  }
  return slots;
}

// ─── CONGOBET extraction ──────────────────────────────────────

async function extractCongobet(matchId, home, away) {
  const raw = await congoJson(`${CONGO_API}events/${matchId}`).catch(() => null);
  if (!raw) return {};
  const slots = {};
  const h = (home || '').toLowerCase();
  const a = (away || '').toLowerCase();
  for (const bt of raw?.eventBetTypes || []) {
    const n = (bt.name || '').trim();
    const nl = n.toLowerCase();
    for (const it of bt.eventBetTypeItems || []) {
      const c = parseFloat(it.odds);
      if (isNaN(c) || c <= 1) continue;
      const sel = (it.shortName || it.name || '').trim();

      // Resultat final (1X2)
      if (nl === 'résultat final' || nl === '1x2') {
        if (sel === '1') slots.result_1 = c;
        if (sel === 'X') slots.result_X = c;
        if (sel === '2') slots.result_2 = c;
      }

      // Double chance
      if (nl === 'double chance') {
        if (sel === '1X') slots.dc_1X = c;
        if (sel === 'X2') slots.dc_X2 = c;
        if (sel === '12') slots.dc_12 = c;
      }

      // Les deux equipes marquent (FT, not 1H/2H)
      if (nl === 'les deux équipes marquent') {
        if (sel === 'Oui') slots.btts_yes = c;
        if (sel === 'Non') slots.btts_no = c;
      }

      // Win to Nil : "[Team] gagne sans encaisser de buts" (FT only)
      if (/gagne sans encaisser/i.test(n) && !/mi-temps/i.test(n) && sel === 'Oui') {
        if (nl.includes(h)) slots.wtn_home = c;
        else if (nl.includes(a)) slots.wtn_away = c;
      }

      // Clean Sheet : "[Team] n'encaisse pas de but" (FT, not 1H/2H)
      if (/n'encaisse pas de but$/i.test(n) && !/mi-temps/i.test(n)) {
        if (nl.includes(h)) {
          if (sel === 'Oui') slots.cs_home_yes = c;
          if (sel === 'Non') slots.cs_home_no = c;
        } else if (nl.includes(a)) {
          if (sel === 'Oui') slots.cs_away_yes = c;
          if (sel === 'Non') slots.cs_away_no = c;
        }
      }

      // Nombre de buts (FT)
      if (nl === 'nombre de buts') {
        if (sel === '> 0.5' || sel === '>0.5') slots.over_0_5 = c;
        if (sel === '< 0.5' || sel === '<0.5') slots.under_0_5 = c;
        if (sel === '> 1.5' || sel === '>1.5') slots.over_1_5 = c;
        if (sel === '< 1.5' || sel === '<1.5') slots.under_1_5 = c;
        if (sel === '> 2.5' || sel === '>2.5') slots.over_2_5 = c;
        if (sel === '< 2.5' || sel === '<2.5') slots.under_2_5 = c;
        if (sel === '> 3.5' || sel === '>3.5') slots.over_3_5 = c;
        if (sel === '< 3.5' || sel === '<3.5') slots.under_3_5 = c;
        if (sel === '> 4.5' || sel === '>4.5') slots.over_4_5 = c;
        if (sel === '< 4.5' || sel === '<4.5') slots.under_4_5 = c;
        if (sel === 'Impair') slots.odd = c;
        if (sel === 'Pair') slots.even = c;
      }

      // Pair / Impair (separate market on Congobet)
      if (nl === 'pair / impair' || nl === 'pair/impair') {
        if (sel === 'Impair') slots.odd = c;
        if (sel === 'Pair') slots.even = c;
      }

      // Total de buts de [Team] (team total, FT)
      if (/^total de buts de /i.test(n) && !/mi-temps/i.test(n)) {
        const tl = nl;
        if (tl.includes(h)) {
          if (sel === '> 0.5' || sel === '>0.5') slots.home_over_0_5 = c;
          if (sel === '< 0.5' || sel === '<0.5') slots.home_under_0_5 = c;
          if (sel === '> 1.5' || sel === '>1.5') slots.home_over_1_5 = c;
          if (sel === '< 1.5' || sel === '<1.5') slots.home_under_1_5 = c;
        } else if (tl.includes(a)) {
          if (sel === '> 0.5' || sel === '>0.5') slots.away_over_0_5 = c;
          if (sel === '< 0.5' || sel === '<0.5') slots.away_under_0_5 = c;
          if (sel === '> 1.5' || sel === '>1.5') slots.away_over_1_5 = c;
          if (sel === '< 1.5' || sel === '<1.5') slots.away_under_1_5 = c;
        }
      }

      // Nombre de buts de [Team] — Odd/Even (FT)
      if (/^nombre de buts de /i.test(n) && !/mi-temps/i.test(n)) {
        if (nl.includes(h)) {
          if (sel === 'Impair') slots.home_odd = c;
          if (sel === 'Pair') slots.home_even = c;
        } else if (nl.includes(a)) {
          if (sel === 'Impair') slots.away_odd = c;
          if (sel === 'Pair') slots.away_even = c;
        }
      }

      // Nombre exact de buts (FT)
      if (nl === 'nombre exact de buts') {
        if (sel === '0') slots.exact_0 = c;
        if (sel === '1') slots.exact_1 = c;
        if (sel === '2') slots.exact_2 = c;
      }

      // Score exact (FT)
      if (nl === 'score exact' && sel === '0:0') slots.score_0_0 = c;

      // Handicap Europeen (FT)
      if (nl === 'handicap européen') {
        if (sel === '1 (0:1)') slots.heur_1_01 = c;
        if (sel === 'X (0:1)') slots.heur_X_01 = c;
        if (sel === '2 (0:1)') slots.heur_2_01 = c;
      }

      // ─── 1ere mi-temps ─────────────────────────────────
      if (nl === '1ère mi-temps - résultat' || nl === '1ère mi-temps - 1x2') {
        if (sel === '1') slots.ht_result_1 = c;
        if (sel === 'X') slots.ht_result_X = c;
        if (sel === '2') slots.ht_result_2 = c;
      }
      if (nl === '1ère mi-temps - nombre de buts') {
        if (sel === '> 0.5' || sel === '>0.5') slots.ht_over_0_5 = c;
        if (sel === '< 0.5' || sel === '<0.5') slots.ht_under_0_5 = c;
        if (sel === '> 1.5' || sel === '>1.5') slots.ht_over_1_5 = c;
        if (sel === '< 1.5' || sel === '<1.5') slots.ht_under_1_5 = c;
        if (sel === 'Impair') slots.ht_odd = c;
        if (sel === 'Pair') slots.ht_even = c;
      }
      if (nl === '1ère mi-temps - score exact' && sel === '0:0') slots.ht_score_0_0 = c;
      if (nl === '1ère mi-temps - nombre exact de buts') {
        if (sel === '0') slots.ht_exact_0 = c;
        if (sel === '1') slots.ht_exact_1 = c;
      }
      if (nl === '1ère mi-temps - les deux équipes marquent') {
        if (sel === 'Oui') slots.ht_btts_yes = c;
        if (sel === 'Non') slots.ht_btts_no = c;
      }
      // 1H Double Chance
      if (nl === '1ère mi-temps - double chance') {
        if (sel === '1X') slots.ht_dc_1X = c;
        if (sel === 'X2') slots.ht_dc_X2 = c;
        if (sel === '12') slots.ht_dc_12 = c;
      }
      // 1H Team Totals
      if (/^1ère mi-temps - nombre de buts de /i.test(n)) {
        if (nl.includes(h)) {
          if (sel === '> 0.5' || sel === '>0.5') slots.ht_home_over_0_5 = c;
          if (sel === '< 0.5' || sel === '<0.5') slots.ht_home_under_0_5 = c;
        } else if (nl.includes(a)) {
          if (sel === '> 0.5' || sel === '>0.5') slots.ht_away_over_0_5 = c;
          if (sel === '< 0.5' || sel === '<0.5') slots.ht_away_under_0_5 = c;
        }
      }

      // ─── 2ème mi-temps ─────────────────────────────────
      if (nl === '2ème mi-temps - résultat du match') {
        if (sel === '1') slots.h2_result_1 = c;
        if (sel === 'X') slots.h2_result_X = c;
        if (sel === '2') slots.h2_result_2 = c;
      }
      if (nl === '2ème mi-temps - double chance') {
        if (sel === '1X') slots.h2_dc_1X = c;
        if (sel === 'X2') slots.h2_dc_X2 = c;
        if (sel === '12') slots.h2_dc_12 = c;
      }
      if (nl === '2ème mi-temps - les deux équipes marquent') {
        if (sel === 'Oui') slots.h2_btts_yes = c;
        if (sel === 'Non') slots.h2_btts_no = c;
      }
      if (nl === '2ème mi-temps - nombre de buts') {
        if (sel === '> 0.5' || sel === '>0.5') slots.h2_over_0_5 = c;
        if (sel === '< 0.5' || sel === '<0.5') slots.h2_under_0_5 = c;
        if (sel === '> 1.5' || sel === '>1.5') slots.h2_over_1_5 = c;
        if (sel === '< 1.5' || sel === '<1.5') slots.h2_under_1_5 = c;
        if (sel === 'Impair') slots.h2_odd = c;
        if (sel === 'Pair') slots.h2_even = c;
      }
      // 2H Clean Sheet
      if (/^2ème mi-temps.*n'encaisse pas de but$/i.test(n)) {
        if (nl.includes(h) && sel === 'Oui') slots.h2_cs_home_yes = c;
        if (nl.includes(a) && sel === 'Oui') slots.h2_cs_away_yes = c;
      }
      // 2H Team Totals
      if (/^2ème mi-temps - nombre de buts de /i.test(n)) {
        if (nl.includes(h)) {
          if (sel === '> 0.5' || sel === '>0.5') slots.h2_home_over_0_5 = c;
          if (sel === '< 0.5' || sel === '<0.5') slots.h2_home_under_0_5 = c;
        } else if (nl.includes(a)) {
          if (sel === '> 0.5' || sel === '>0.5') slots.h2_away_over_0_5 = c;
          if (sel === '< 0.5' || sel === '<0.5') slots.h2_away_under_0_5 = c;
        }
      }
    }
  }
  return slots;
}

// ─── 1XBET extraction ────────────────────────────────────────

async function extract1xbet(matchId) {
  const url = `${FEED}/service-api/LineFeed/GetGameZip?id=${matchId}&lng=fr&isSubGames=true&GroupEvents=true&countevents=2500&grMode=4&country=${COUNTRY}&marketType=1&isNewBuilder=true`;
  const raw = await viaWorker(url).catch(() => null);
  if (!raw?.Value) return {};
  const slots = {};
  const GE = raw.Value.GE || [];
  function iter(gid, cb) {
    const g = GE.find(x => x.G === gid);
    if (!g?.E) return;
    for (const sub of g.E) {
      for (const it of (Array.isArray(sub) ? sub : [sub])) {
        if (it?.C == null) continue;
        const c = parseFloat(it.C);
        if (!isNaN(c) && c > 1) cb(it, c);
      }
    }
  }
  // 1X2 (G=1): T1=home, T2=draw, T3=away
  iter(1, (i, c) => {
    if (i.T === 1) slots.result_1 = c;
    if (i.T === 2) slots.result_X = c;
    if (i.T === 3) slots.result_2 = c;
  });
  // DC (G=8): T4=1X, T5=12, T6=X2
  iter(8, (i, c) => {
    if (i.T === 4) slots.dc_1X = c;
    if (i.T === 5) slots.dc_12 = c;
    if (i.T === 6) slots.dc_X2 = c;
  });
  // BTTS (G=19): T180=yes, T181=no
  iter(19, (i, c) => {
    if (i.T === 180) slots.btts_yes = c;
    if (i.T === 181) slots.btts_no = c;
  });
  // Total (G=17): T9=over, T10=under, P=line
  iter(17, (i, c) => {
    const p = i.P;
    if (i.T === 9) {
      if (p == 0.5) slots.over_0_5 = c;
      if (p == 1.5) slots.over_1_5 = c;
      if (p == 2.5) slots.over_2_5 = c;
      if (p == 3.5) slots.over_3_5 = c;
      if (p == 4.5) slots.over_4_5 = c;
    }
    if (i.T === 10) {
      if (p == 0.5) slots.under_0_5 = c;
      if (p == 1.5) slots.under_1_5 = c;
      if (p == 2.5) slots.under_2_5 = c;
      if (p == 3.5) slots.under_3_5 = c;
      if (p == 4.5) slots.under_4_5 = c;
    }
  });
  // Odd/Even (G=14): T183=odd, T182=even
  iter(14, (i, c) => {
    if (i.T === 183) slots.odd = c;
    if (i.T === 182) slots.even = c;
  });
  // Home total (G=15): T11=over, T12=under
  iter(15, (i, c) => {
    if (i.T === 11) {
      if (i.P == 0.5) slots.home_over_0_5 = c;
      if (i.P == 1.5) slots.home_over_1_5 = c;
    }
    if (i.T === 12) {
      if (i.P == 0.5) slots.home_under_0_5 = c;
      if (i.P == 1.5) slots.home_under_1_5 = c;
    }
  });
  // Away total (G=62): T13=over, T14=under
  iter(62, (i, c) => {
    if (i.T === 13) {
      if (i.P == 0.5) slots.away_over_0_5 = c;
      if (i.P == 1.5) slots.away_over_1_5 = c;
    }
    if (i.T === 14) {
      if (i.P == 0.5) slots.away_under_0_5 = c;
      if (i.P == 1.5) slots.away_under_1_5 = c;
    }
  });
  // SubGames: 1H and 2H markets
  const SG = raw.Value.SG || [];
  for (const sg of SG) {
    const pn = (sg.PN || '').toLowerCase();
    const is1H = /1\-?[eè]re|1st|half.*1|mi.temps.*1/i.test(pn);
    const is2H = /2\-?[eè]me|2nd|half.*2|mi.temps.*2/i.test(pn);
    if (!is1H && !is2H) continue;
    const sgUrl = `${FEED}/service-api/LineFeed/GetGameZip?id=${sg.I}&lng=fr&isSubGames=false&GroupEvents=true&countevents=250&grMode=4&country=${COUNTRY}&marketType=1&isNewBuilder=true`;
    const sgData = await viaWorker(sgUrl).catch(() => null);
    if (!sgData?.Value?.GE) continue;
    const SGE = sgData.Value.GE;
    function sIter(gid, cb) {
      const g = SGE.find(x => x.G === gid);
      if (!g?.E) return;
      for (const sub of g.E) {
        for (const it of (Array.isArray(sub) ? sub : [sub])) {
          if (it?.C == null) continue;
          const c = parseFloat(it.C);
          if (!isNaN(c) && c > 1) cb(it, c);
        }
      }
    }
    const pfx = is1H ? 'ht' : 'h2';
    // 1X2 (G=1)
    sIter(1, (i, c) => {
      if (i.T === 1) slots[`${pfx}_result_1`] = c;
      if (i.T === 2) slots[`${pfx}_result_X`] = c;
      if (i.T === 3) slots[`${pfx}_result_2`] = c;
    });
    // DC (G=8)
    sIter(8, (i, c) => {
      if (i.T === 4) slots[`${pfx}_dc_1X`] = c;
      if (i.T === 5) slots[`${pfx}_dc_12`] = c;
      if (i.T === 6) slots[`${pfx}_dc_X2`] = c;
    });
    // Total (G=17)
    sIter(17, (i, c) => {
      if (i.T === 9 && i.P == 0.5) slots[`${pfx}_over_0_5`] = c;
      if (i.T === 10 && i.P == 0.5) slots[`${pfx}_under_0_5`] = c;
      if (i.T === 9 && i.P == 1.5) slots[`${pfx}_over_1_5`] = c;
      if (i.T === 10 && i.P == 1.5) slots[`${pfx}_under_1_5`] = c;
    });
    // Odd/Even (G=14)
    sIter(14, (i, c) => {
      if (i.T === 183) slots[`${pfx}_odd`] = c;
      if (i.T === 182) slots[`${pfx}_even`] = c;
    });
    // BTTS (G=19)
    sIter(19, (i, c) => {
      if (i.T === 180) slots[`${pfx}_btts_yes`] = c;
      if (i.T === 181) slots[`${pfx}_btts_no`] = c;
    });
    // Home total (G=15)
    sIter(15, (i, c) => {
      if (i.T === 11 && i.P == 0.5) slots[`${pfx}_home_over_0_5`] = c;
      if (i.T === 12 && i.P == 0.5) slots[`${pfx}_home_under_0_5`] = c;
    });
    // Away total (G=62)
    sIter(62, (i, c) => {
      if (i.T === 13 && i.P == 0.5) slots[`${pfx}_away_over_0_5`] = c;
      if (i.T === 14 && i.P == 0.5) slots[`${pfx}_away_under_0_5`] = c;
    });
  }
  return slots;
}

// ─── 1WIN extraction ─────────────────────────────────────────

function tokenOverlap(a, b) {
  const ta = a.toLowerCase().split(/[\s\-_.]+/).filter(Boolean);
  const tb = b.toLowerCase().split(/[\s\-_.]+/).filter(Boolean);
  if (!ta.length || !tb.length) return 0;
  let hits = 0;
  for (const t of ta) if (tb.includes(t)) hits++;
  return hits / Math.max(ta.length, tb.length);
}

async function extract1win(matchId, home, away) {
  const raw = await fetchOddsWS([matchId], { timeoutMs: 20000, quietMs: 3000 }).catch(() => new Map());
  const data = raw.get(matchId) || raw.get(String(matchId)) || raw.get(Number(matchId));
  if (!data) return {};
  const slots = {};
  for (const [gn, oddsList] of Object.entries(data)) {
    const gnl = gn.toLowerCase().trim();
    for (const o of oddsList || []) {
      if (!o || o.status !== 1) continue;
      const c = Number(o.cf);
      if (isNaN(c) || c <= 1) continue;
      const name = (o.name || '').trim();
      const nl = name.toLowerCase();

      // Result (1X2)
      if (gnl === 'result' || gnl === 'match result' || gnl === '1x2') {
        if (nl === 'w1' || nl === '1') slots.result_1 = c;
        if (nl === 'x' || nl === 'draw') slots.result_X = c;
        if (nl === 'w2' || nl === '2') slots.result_2 = c;
      }

      // Double Chance (exact group match, not "1st half. Double chance")
      if (gnl === 'double chance') {
        if (nl === '1x' || /home or draw/i.test(name)) slots.dc_1X = c;
        if (nl === 'x2' || /draw or .+/i.test(name)) slots.dc_X2 = c;
        if (nl === '12' || /home or away/i.test(name)) slots.dc_12 = c;
      }

      // Both teams to score (FT)
      if (gnl === 'both teams to score') {
        if (nl === 'yes') slots.btts_yes = c;
        if (nl === 'no') slots.btts_no = c;
      }

      // Total (FT)
      if (gnl === 'total') {
        if (/over 0\.5/i.test(name)) slots.over_0_5 = c;
        if (/under 0\.5/i.test(name)) slots.under_0_5 = c;
        if (/over 1\.5/i.test(name)) slots.over_1_5 = c;
        if (/under 1\.5/i.test(name)) slots.under_1_5 = c;
        if (/over 2\.5/i.test(name)) slots.over_2_5 = c;
        if (/under 2\.5/i.test(name)) slots.under_2_5 = c;
        if (/over 3\.5/i.test(name)) slots.over_3_5 = c;
        if (/under 3\.5/i.test(name)) slots.under_3_5 = c;
        if (/over 4\.5/i.test(name)) slots.over_4_5 = c;
        if (/under 4\.5/i.test(name)) slots.under_4_5 = c;
      }

      // Odd/Even
      if (gnl === 'total. even/odd' || gnl === 'odd/even') {
        if (nl === 'odd') slots.odd = c;
        if (nl === 'even') slots.even = c;
      }

      // 1st half result
      if (gnl === '1st half. result' || gnl === '1st half. 1x2') {
        if (nl === 'w1' || nl === '1') slots.ht_result_1 = c;
        if (nl === 'x' || nl === 'draw') slots.ht_result_X = c;
        if (nl === 'w2' || nl === '2') slots.ht_result_2 = c;
      }

      // 1st half odd/even
      if (gnl === '1st half. total. even/odd' || gnl === '1st half. odd/even' || gnl === '1st half. even/odd') {
        if (nl === 'odd') slots.ht_odd = c;
        if (nl === 'even') slots.ht_even = c;
      }

      // 1st half markets
      if (gnl === '1st half. total') {
        if (/over 0\.5/i.test(name)) slots.ht_over_0_5 = c;
        if (/under 0\.5/i.test(name)) slots.ht_under_0_5 = c;
        if (/over 1\.5/i.test(name)) slots.ht_over_1_5 = c;
        if (/under 1\.5/i.test(name)) slots.ht_under_1_5 = c;
      }
      if (gnl === '1st half. both teams to score') {
        if (nl === 'yes') slots.ht_btts_yes = c;
        if (nl === 'no') slots.ht_btts_no = c;
      }

      // Team totals — group names like "[Team] total"
      if (/\btotal$/i.test(gnl) && gnl !== 'total' && !gnl.startsWith('1st') && !gnl.startsWith('2nd')) {
        const teamPart = gn.replace(/\s*total$/i, '').trim();
        const sH = tokenOverlap(teamPart, home || '');
        const sA = tokenOverlap(teamPart, away || '');
        const side = sH > sA ? 'home' : sA > sH ? 'away' : null;
        if (side) {
          if (/over 0\.5/i.test(name)) slots[`${side}_over_0_5`] = c;
          if (/under 0\.5/i.test(name)) slots[`${side}_under_0_5`] = c;
          if (/over 1\.5/i.test(name)) slots[`${side}_over_1_5`] = c;
          if (/under 1\.5/i.test(name)) slots[`${side}_under_1_5`] = c;
        }
      }

      // Team odd/even — group names like "[Team] total. even/odd"
      if (/\b(even\/odd|odd\/even)$/i.test(gnl) && !gnl.startsWith('1st') && !gnl.startsWith('2nd') && gnl !== 'total. even/odd' && gnl !== 'odd/even') {
        const teamPart = gn.replace(/\s*(total\.\s*)?(even\/odd|odd\/even)$/i, '').trim();
        const sH = tokenOverlap(teamPart, home || '');
        const sA = tokenOverlap(teamPart, away || '');
        const side = sH > sA ? 'home' : sA > sH ? 'away' : null;
        if (side) {
          if (nl === 'odd') slots[`${side}_odd`] = c;
          if (nl === 'even') slots[`${side}_even`] = c;
        }
      }

      // 1st half Double Chance
      if (gnl === '1st half. double chance') {
        if (nl === '1x' || /home or draw/i.test(name)) slots.ht_dc_1X = c;
        if (nl === 'x2' || /draw or .+/i.test(name)) slots.ht_dc_X2 = c;
        if (nl === '12' || /home or away/i.test(name)) slots.ht_dc_12 = c;
      }

      // 1st half team totals
      if (/^1st half\.\s.+\btotal$/i.test(gnl)) {
        const teamPart = gn.replace(/^1st half\.\s*/i, '').replace(/\s*total$/i, '').trim();
        const sH = tokenOverlap(teamPart, home || '');
        const sA = tokenOverlap(teamPart, away || '');
        const side = sH > sA ? 'home' : sA > sH ? 'away' : null;
        if (side) {
          if (/over 0\.5/i.test(name)) slots[`ht_${side}_over_0_5`] = c;
          if (/under 0\.5/i.test(name)) slots[`ht_${side}_under_0_5`] = c;
        }
      }

      // ─── 2nd half markets ─────────────────────────────
      if (gnl === '2nd half. result' || gnl === '2nd half. 1x2') {
        if (nl === 'w1' || nl === '1') slots.h2_result_1 = c;
        if (nl === 'x' || nl === 'draw') slots.h2_result_X = c;
        if (nl === 'w2' || nl === '2') slots.h2_result_2 = c;
      }
      if (gnl === '2nd half. double chance') {
        if (nl === '1x' || /home or draw/i.test(name)) slots.h2_dc_1X = c;
        if (nl === 'x2' || /draw or .+/i.test(name)) slots.h2_dc_X2 = c;
        if (nl === '12' || /home or away/i.test(name)) slots.h2_dc_12 = c;
      }
      if (gnl === '2nd half. both teams to score') {
        if (nl === 'yes') slots.h2_btts_yes = c;
        if (nl === 'no') slots.h2_btts_no = c;
      }
      if (gnl === '2nd half. total') {
        if (/over 0\.5/i.test(name)) slots.h2_over_0_5 = c;
        if (/under 0\.5/i.test(name)) slots.h2_under_0_5 = c;
        if (/over 1\.5/i.test(name)) slots.h2_over_1_5 = c;
        if (/under 1\.5/i.test(name)) slots.h2_under_1_5 = c;
      }
      if (gnl === '2nd half. total. even/odd' || gnl === '2nd half. odd/even' || gnl === '2nd half. even/odd') {
        if (nl === 'odd') slots.h2_odd = c;
        if (nl === 'even') slots.h2_even = c;
      }
      // 2nd half team totals
      if (/^2nd half\.\s.+\btotal$/i.test(gnl)) {
        const teamPart = gn.replace(/^2nd half\.\s*/i, '').replace(/\s*total$/i, '').trim();
        const sH = tokenOverlap(teamPart, home || '');
        const sA = tokenOverlap(teamPart, away || '');
        const side = sH > sA ? 'home' : sA > sH ? 'away' : null;
        if (side) {
          if (/over 0\.5/i.test(name)) slots[`h2_${side}_over_0_5`] = c;
          if (/under 0\.5/i.test(name)) slots[`h2_${side}_under_0_5`] = c;
        }
      }
    }
  }
  return slots;
}

const EXT = {
  betpawa: (m) => extractBetpawa(m.id),
  congobet: (m) => extractCongobet(m.id, m.home, m.away),
  '1xbet': (m) => extract1xbet(m.id),
  '1win': (m) => extract1win(m.id, m.home, m.away),
};

// ─── Families / Partitions ─────────────────────────────────────

const FAMILIES = [
  { id: 'A', name: 'WTN Home + WTN Away + BTTS Yes + Score 0-0',
    slots: ['wtn_home', 'wtn_away', 'btts_yes', 'score_0_0'],
    alt: { score_0_0: ['exact_0', 'under_0_5'] } },
  { id: 'B', name: 'Exact 0 + Exact 1 + Over 1.5',
    slots: ['exact_0', 'exact_1', 'over_1_5'] },
  { id: 'C', name: 'Exact 0 + Exact 1 + Exact 2 + Over 2.5',
    slots: ['exact_0', 'exact_1', 'exact_2', 'over_2_5'] },
  { id: 'D', name: 'CS Home Yes vs Away Over 0.5 (cross-market)',
    slots: ['cs_home_yes', 'away_over_0_5'] },
  { id: 'E', name: 'CS Away Yes vs Home Over 0.5 (cross-market)',
    slots: ['cs_away_yes', 'home_over_0_5'] },
  { id: 'F', name: 'Luzern: DC X2 + Heur 1(0:1) + Heur X(0:1)',
    slots: ['dc_X2', 'heur_1_01', 'heur_X_01'] },
  { id: 'G', name: '1H Under 0.5 vs 1H Over 0.5 (cross-book)',
    slots: ['ht_under_0_5', 'ht_over_0_5'],
    alt: { ht_under_0_5: ['ht_score_0_0', 'ht_exact_0'] } },
  { id: 'H', name: '1H Exact 0 + 1H Exact 1 + 1H Over 1.5',
    slots: ['ht_exact_0', 'ht_exact_1', 'ht_over_1_5'] },
  { id: 'I', name: 'Odd vs Even (cross-book)',
    slots: ['odd', 'even'] },
  { id: 'J', name: '1H Odd vs 1H Even (cross-book)',
    slots: ['ht_odd', 'ht_even'] },
  { id: 'K', name: 'BTTS Yes vs BTTS No (cross-book)',
    slots: ['btts_yes', 'btts_no'] },
  { id: 'L', name: '1H BTTS Yes vs 1H BTTS No (cross-book)',
    slots: ['ht_btts_yes', 'ht_btts_no'] },
  { id: 'M', name: 'Over 0.5 vs Under 0.5 (cross-book)',
    slots: ['over_0_5', 'under_0_5'] },
  { id: 'N', name: 'Over 1.5 vs Under 1.5 (cross-book)',
    slots: ['over_1_5', 'under_1_5'] },
  { id: 'O', name: 'Over 2.5 vs Under 2.5 (cross-book)',
    slots: ['over_2_5', 'under_2_5'] },
  { id: 'P', name: 'Home Over 0.5 vs Home Under 0.5 (cross-book)',
    slots: ['home_over_0_5', 'home_under_0_5'] },
  { id: 'Q', name: 'Away Over 0.5 vs Away Under 0.5 (cross-book)',
    slots: ['away_over_0_5', 'away_under_0_5'] },
  { id: 'R', name: '1H Over 1.5 vs 1H Under 1.5 (cross-book)',
    slots: ['ht_over_1_5', 'ht_under_1_5'] },
  { id: 'S', name: '1X2 cross-book (3-way)',
    slots: ['result_1', 'result_X', 'result_2'] },
  { id: 'T', name: 'DC 1X + Result 2 (cross-market)',
    slots: ['dc_1X', 'result_2'] },
  { id: 'U', name: 'DC X2 + Result 1 (cross-market)',
    slots: ['dc_X2', 'result_1'] },
  { id: 'V', name: 'DC 12 + Result X (cross-market)',
    slots: ['dc_12', 'result_X'] },
  { id: 'W', name: 'Over 3.5 vs Under 3.5 (cross-book)',
    slots: ['over_3_5', 'under_3_5'] },
  { id: 'X', name: 'CS Home No vs Away Under 0.5 (cross-market)',
    slots: ['cs_home_no', 'away_under_0_5'] },
  { id: 'Y', name: 'CS Away No vs Home Under 0.5 (cross-market)',
    slots: ['cs_away_no', 'home_under_0_5'] },
  { id: 'Z', name: '1H 1X2 cross-book (3-way)',
    slots: ['ht_result_1', 'ht_result_X', 'ht_result_2'] },
  // ─── 2H mirrors of 1H families ─────────────────────
  { id: 'AA', name: '2H Over 0.5 vs 2H Under 0.5 (cross-book)',
    slots: ['h2_over_0_5', 'h2_under_0_5'] },
  { id: 'AB', name: '2H Over 1.5 vs 2H Under 1.5 (cross-book)',
    slots: ['h2_over_1_5', 'h2_under_1_5'] },
  { id: 'AC', name: '2H BTTS Yes vs 2H BTTS No (cross-book)',
    slots: ['h2_btts_yes', 'h2_btts_no'] },
  { id: 'AD', name: '2H Odd vs 2H Even (cross-book)',
    slots: ['h2_odd', 'h2_even'] },
  { id: 'AE', name: '2H 1X2 cross-book (3-way)',
    slots: ['h2_result_1', 'h2_result_X', 'h2_result_2'] },
  // ─── 2H DC cross-market ────────────────────────────
  { id: 'AF', name: '2H DC 1X + 2H Result 2 (cross-market)',
    slots: ['h2_dc_1X', 'h2_result_2'] },
  { id: 'AG', name: '2H DC X2 + 2H Result 1 (cross-market)',
    slots: ['h2_dc_X2', 'h2_result_1'] },
  { id: 'AH', name: '2H DC 12 + 2H Result X (cross-market)',
    slots: ['h2_dc_12', 'h2_result_X'] },
  // ─── 1H DC cross-market ────────────────────────────
  { id: 'AI', name: '1H DC 1X + 1H Result 2 (cross-market)',
    slots: ['ht_dc_1X', 'ht_result_2'] },
  { id: 'AJ', name: '1H DC X2 + 1H Result 1 (cross-market)',
    slots: ['ht_dc_X2', 'ht_result_1'] },
  { id: 'AK', name: '1H DC 12 + 1H Result X (cross-market)',
    slots: ['ht_dc_12', 'ht_result_X'] },
  // ─── Team-specific ─────────────────────────────────
  { id: 'AL', name: 'Home Odd vs Home Even (cross-book)',
    slots: ['home_odd', 'home_even'] },
  { id: 'AM', name: 'Away Odd vs Away Even (cross-book)',
    slots: ['away_odd', 'away_even'] },
  { id: 'AN', name: 'Home Over 1.5 vs Home Under 1.5 (cross-book)',
    slots: ['home_over_1_5', 'home_under_1_5'] },
  { id: 'AO', name: 'Away Over 1.5 vs Away Under 1.5 (cross-book)',
    slots: ['away_over_1_5', 'away_under_1_5'] },
  // ─── Higher line ───────────────────────────────────
  { id: 'AP', name: 'Over 4.5 vs Under 4.5 (cross-book)',
    slots: ['over_4_5', 'under_4_5'] },
  // ─── 1H Team Totals ───────────────────────────────
  { id: 'AQ', name: '1H Home Over 0.5 vs 1H Home Under 0.5 (cross-book)',
    slots: ['ht_home_over_0_5', 'ht_home_under_0_5'] },
  { id: 'AR', name: '1H Away Over 0.5 vs 1H Away Under 0.5 (cross-book)',
    slots: ['ht_away_over_0_5', 'ht_away_under_0_5'] },
  // ─── 2H Team Totals ───────────────────────────────
  { id: 'AS', name: '2H Home Over 0.5 vs 2H Home Under 0.5 (cross-book)',
    slots: ['h2_home_over_0_5', 'h2_home_under_0_5'] },
  { id: 'AT', name: '2H Away Over 0.5 vs 2H Away Under 0.5 (cross-book)',
    slots: ['h2_away_over_0_5', 'h2_away_under_0_5'] },
  // ─── 2H CS cross-market ────────────────────────────
  { id: 'AU', name: '2H CS Home Yes vs 2H Away Over 0.5 (cross-market)',
    slots: ['h2_cs_home_yes', 'h2_away_over_0_5'] },
  { id: 'AV', name: '2H CS Away Yes vs 2H Home Over 0.5 (cross-market)',
    slots: ['h2_cs_away_yes', 'h2_home_over_0_5'] },
];

function checkFamily(family, bookSlots) {
  const best = {};
  for (const slot of family.slots) {
    let maxOdds = 0, bestBook = null;
    for (const [book, bs] of Object.entries(bookSlots)) {
      let v = bs[slot];
      if (!v && family.alt?.[slot]) {
        for (const altSlot of family.alt[slot]) {
          if (bs[altSlot]) { v = bs[altSlot]; break; }
        }
      }
      if (v && v > maxOdds) { maxOdds = v; bestBook = book; }
    }
    if (!maxOdds) return null;
    best[slot] = { odds: maxOdds, book: bestBook };
  }
  // For 2-way families, require at least 2 different books
  const booksUsed = new Set(Object.values(best).map(b => b.book));
  if (family.slots.length <= 2 && booksUsed.size < 2) return null;
  const ip = Object.values(best).reduce((s, b) => s + 1 / b.odds, 0);
  const margin = (1 - ip) * 100;
  return { ...best, ip, margin };
}

// ─── Main ──────────────────────────────────────────────────────
const t0 = Date.now();
console.log(`Cross-market scanner : ${TOP_MATCHES} matchs, ${HORIZON_H}h, batch=${BATCH}`);

const catalogs = new Map();
await Promise.all(BOOKS.map(async key => {
  const b = bookmakersByKey[key]; if (!b) return;
  try {
    const ms = await b.listMatches({ live: false, sport: 'football', horizonHours: HORIZON_H });
    catalogs.set(key, ms);
    console.log(`[${key}] ${ms.length} matchs`);
  } catch (e) { console.log(`[${key}] KO: ${e.message}`); }
}));

let entries = alignCatalogs(catalogs, { minBooks: 2, horizonMs: Date.now() + HORIZON_H * 3600_000 });
entries.sort((a, b) => {
  const na = Object.keys(a.matches).length, nb = Object.keys(b.matches).length;
  if (nb !== na) return nb - na;
  return (a.ref.start || 0) - (b.ref.start || 0);
});
entries = entries.slice(0, TOP_MATCHES);
console.log(`${entries.length} matchs alignes (>= 2 books)`);

// ─── Verify mode: dump extracted slots for first N matches ────
const VERIFY = parseInt(process.env.VERIFY || '0', 10);
if (VERIFY > 0) {
  const verifyEntries = entries.slice(0, VERIFY);
  console.log(`\n=== VERIFY MODE: dumping ${verifyEntries.length} matches ===\n`);
  for (const entry of verifyEntries) {
    console.log(`--- ${entry.ref.home} vs ${entry.ref.away} ---`);
    console.log(`  Books: ${Object.keys(entry.matches).join(', ')}`);
    const bookSlots = {};
    await Promise.all(Object.entries(entry.matches).map(async ([book, m]) => {
      if (!EXT[book]) return;
      try {
        const matchInfo = { id: m.id, home: entry.ref.home, away: entry.ref.away };
        bookSlots[book] = await EXT[book](matchInfo);
      } catch (e) { bookSlots[book] = {}; console.log(`  [${book}] ERR: ${e.message}`); }
    }));
    for (const [book, bs] of Object.entries(bookSlots)) {
      const filled = Object.entries(bs).filter(([, v]) => v > 0);
      if (!filled.length) { console.log(`  [${book}] (no slots)`); continue; }
      console.log(`  [${book}] ${filled.length} slots:`);
      for (const [k, v] of filled.sort((a, b) => a[0].localeCompare(b[0]))) {
        console.log(`    ${k}: ${v}`);
      }
    }
    console.log();
  }
  console.log('=== END VERIFY ===');
  process.exit(0);
}

const allArbs = [];
const nearMisses = [];
const familyStats = {};
for (const f of FAMILIES) familyStats[f.id] = { tested: 0, bestMargin: -Infinity };
let processed = 0;

for (let i = 0; i < entries.length; i += BATCH) {
  const batch = entries.slice(i, i + BATCH);
  await Promise.all(batch.map(async entry => {
    const bookSlots = {};
    await Promise.all(Object.entries(entry.matches).map(async ([book, m]) => {
      if (!EXT[book]) return;
      try {
        const matchInfo = { id: m.id, home: entry.ref.home, away: entry.ref.away };
        bookSlots[book] = await EXT[book](matchInfo);
      } catch { bookSlots[book] = {}; }
    }));

    for (const family of FAMILIES) {
      const result = checkFamily(family, bookSlots);
      if (!result) continue;
      familyStats[family.id].tested++;
      if (result.margin > familyStats[family.id].bestMargin)
        familyStats[family.id].bestMargin = result.margin;
      const entry_details = Object.entries(result)
        .filter(([k]) => !['ip', 'margin'].includes(k))
        .map(([slot, info]) => `${slot}: ${info.odds.toFixed(2)} @${info.book}`)
        .join(' | ');
      const row = {
        match: `${entry.ref.home} vs ${entry.ref.away}`,
        league: entry.ref.league || '?',
        kickoff: entry.ref.start ? new Date(entry.ref.start).toISOString().slice(0, 16) : '?',
        family: family.id,
        familyName: family.name,
        margin: result.margin,
        details: entry_details,
      };
      if (result.margin > 0) {
        allArbs.push(row);
      } else if (result.margin > -2) {
        nearMisses.push(row);
      }
    }
    processed++;
  }));
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`  ${processed}/${entries.length} matchs (${elapsed}s)`);
}

allArbs.sort((a, b) => b.margin - a.margin);
nearMisses.sort((a, b) => b.margin - a.margin);

// ─── Report ───────────────────────────────────────────────────
let md = `# Cross-Market Scanner — Resultats\n\n`;
md += `Date: ${new Date().toISOString()}\n`;
md += `Matchs scannes: ${processed}\n`;
md += `Duree: ${((Date.now() - t0) / 1000).toFixed(0)}s\n`;
md += `Horizon: ${HORIZON_H}h\n\n`;

if (allArbs.length === 0) {
  md += `## Aucun arbitrage trouve\n\n`;
  md += `Aucune combinaison cross-market rentable sur ${processed} matchs.\n\n`;
} else {
  md += `## ${allArbs.length} arbitrages trouves !\n\n`;
  md += `| # | Match | Ligue | Kickoff | Famille | Marge | Details |\n`;
  md += `|---|-------|-------|---------|---------|------:|--------|\n`;
  for (let i = 0; i < allArbs.length; i++) {
    const a = allArbs[i];
    md += `| ${i + 1} | ${a.match} | ${a.league} | ${a.kickoff} | ${a.familyName} | ${a.margin.toFixed(2)}% | ${a.details} |\n`;
  }
}

if (nearMisses.length > 0) {
  const topNear = nearMisses.slice(0, 20);
  md += `\n## Near misses (marge entre -2% et 0%) — Top ${topNear.length}\n\n`;
  md += `| # | Match | Famille | Marge | Details |\n`;
  md += `|---|-------|---------|------:|--------|\n`;
  for (let i = 0; i < topNear.length; i++) {
    const a = topNear[i];
    md += `| ${i + 1} | ${a.match} | ${a.familyName} | ${a.margin.toFixed(2)}% | ${a.details} |\n`;
  }
}

md += `\n---\n\n## Statistiques par famille\n\n`;
md += `| ID | Famille | Matchs testes | Meilleure marge |\n`;
md += `|----|---------|--------------|----------------:|\n`;
for (const f of FAMILIES) {
  const s = familyStats[f.id];
  const best = s.bestMargin > -Infinity ? `${s.bestMargin.toFixed(2)}%` : '-';
  md += `| ${f.id} | ${f.name} | ${s.tested} | ${best} |\n`;
}

md += `\n## Bookmakers utilises\n\n`;
for (const k of BOOKS) {
  const n = catalogs.get(k)?.length || 0;
  md += `- ${k}: ${n} matchs catalogues\n`;
}

mkdirSync('docs', { recursive: true });
writeFileSync('docs/cross-market-scan.md', md);
console.log(`\n${allArbs.length} arbs trouves. docs/cross-market-scan.md ecrit.`);
process.exit(0);
