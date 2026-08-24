#!/usr/bin/env node
// SCANNER PATTERN "LUZERN" — cherche EXACTEMENT le combo qui a marché à 10.42% :
//   A : DC X2 (Draw ∪ Away wins)          — condition : a ≥ h
//   B : Handicap Européen "1 (0:1)"        — condition : h > a+1 (home wins by 2+)
//   C : Handicap Européen "X (0:1)"        — condition : h = a+1 (home wins by exactly 1)
//
// Ces 3 conditions couvrent 100% des scores possibles et sont mutuellement exclusives.
// Le script prend la MEILLEURE cote cross-book pour chaque slot A / B / C.
//
// Identification EXACTE des marchés par book :
//
//  SLOT A (DC X2) — équivalences reconnues :
//    - betpawa   : "Double Chance - FT" sélection "X2" (ou "Draw / <away team>")
//    - congobet  : "Double chance" sélection "X2"
//    - 1xbet     : group "Double Chance" (G=8) sélection T=6 "X2"
//    - 1win      : group "Double Chance" sélection "X2"
//    Alternative reconnaissable : "Handicap 1X2 - FT [-1]" sélection "2" (équivalent a ≥ h)
//    Alternative reconnaissable : "Asian Handicap - FT [-0.5]" sélection "2" (équivalent a ≥ h+0 = away wins or draw)
//
//  SLOT B (h > a+1 = home wins by 2+) — équivalences reconnues :
//    - congobet  : "Handicap européen" sélection "1 (0:1)"
//    - betpawa   : "Handicap 1X2 - FT [-1]" sélection "1"
//    - 1xbet     : "European Handicap" avec spec 0:1 sélection "1" (rare, pas garanti)
//    Alternative : "Asian Handicap - FT [-1.5]" sélection "1" (h - 1.5 > a → h ≥ a+2 = h wins by 2+)
//
//  SLOT C (h = a+1 = home wins by exactly 1) — équivalences reconnues :
//    - congobet  : "Handicap européen" sélection "X (0:1)"
//    - betpawa   : "Handicap 1X2 - FT [-1]" sélection "X"
//    Alternative : Winning Margin "Home by 1" (chez betpawa/congobet)
//    Alternative : Correct Score exacts h=a+1 (0-1... impossible pour home wins) — ignore

import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';
import { bpFetchEvent } from '../src/bookmakers/betpawa/api.js';
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { FEED, COUNTRY, viaWorker } from '../src/bookmakers/xbet/api.js';
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const BOOKS = ['1xbet', '1win', 'congobet', 'betpawa'];
const TOP_MATCHES = parseInt(process.env.TOP_MATCHES || '500', 10);
const HORIZON_H = parseInt(process.env.HORIZON_HOURS || '168', 10);
const MATCH_BATCH = parseInt(process.env.MATCH_BATCH || '20', 10);
const BANKROLL = 100000;

// Top championnats à privilégier (les seuls où le Handicap Européen 0:1 est proposé)
const TOP_LEAGUES = /premier league|premier-league|primera division|la ?liga|liga(?!\s*mx)|bundesliga|serie a|serie b|serie c|ligue 1|ligue 2|championship|primeira liga|eredivisie|super lig(?!ue)|super league|champions league|europa league|europa conference|conference league|nations league|world cup|copa libertadores|copa sudamericana|copa america|copa argentina|copa del rey|coupe de france|dfb pokal|coppa italia|scottish premier|belgian pro|allsvenskan|superliga|major league soccer|mls$|brasileirao|primera nacional|nacional|argentine|brazil serie|italy|germany|england|spain|france|portugal|holland|netherlands|belgium|scotland|italie|allemagne|angleterre|espagne|france|portugal|hollande|pays.bas|belgique|ecosse|suede|denmark|denmark|swiss|suisse|swiss super|austria autriche|russia|russie/i;

function isTopLeague(league) {
  if (!league) return false;
  return TOP_LEAGUES.test(String(league).toLowerCase());
}

function norm(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ');
}

// ─── Extracteurs ────────────────────────────────────────────────────────────
// Chaque extracteur retourne { A, B, C } avec la meilleure cote trouvée dans ce book.
// Retourne null si le slot n'est pas disponible.

async function extractBetpawa(matchId) {
  const raw = await bpFetchEvent(matchId, 15_000).catch(() => null);
  if (!raw) return { A: null, B: null, C: null };
  let A = null, B = null, C = null;
  for (const mk of raw?.markets || []) {
    const name = mk.marketType?.name || mk.name || '';
    const nname = norm(name);
    // SLOT A : Double Chance - FT sélection X2
    if (nname === 'double chance - ft') {
      for (const row of mk.row || []) {
        for (const p of row.prices || []) {
          const sel = norm(p.name || p.displayName || '');
          const c = parseFloat(p.odds);
          if (isNaN(c) || c <= 1 || c >= 40) continue;
          if (sel === 'x2' || /draw\s*[\/ ]\s*away|draw or/.test(sel)) {
            if (!A || c > A.odds) A = { book: 'betpawa', market: name, selection: p.name, odds: c };
          }
        }
      }
    }
    // SLOT B et C : Handicap 1X2 - FT [-1]
    if (nname === 'handicap 1x2 - ft' && String(mk.row?.[0]?.specifier?.hcp) === '-1') {
      for (const row of mk.row || []) {
        if (String(row?.specifier?.hcp) !== '-1') continue;
        for (const p of row.prices || []) {
          const sel = norm(p.name || p.displayName || '');
          const c = parseFloat(p.odds);
          if (isNaN(c) || c <= 1 || c >= 40) continue;
          if (sel === '1' || sel === 'home') {
            if (!B || c > B.odds) B = { book: 'betpawa', market: `${name} [-1]`, selection: p.name, odds: c };
          } else if (sel === 'x' || sel === 'draw') {
            if (!C || c > C.odds) C = { book: 'betpawa', market: `${name} [-1]`, selection: p.name, odds: c };
          }
        }
      }
    }
  }
  return { A, B, C };
}

async function extractCongobet(matchId) {
  const raw = await congoJson(`${CONGO_API}events/${matchId}`).catch(() => null);
  if (!raw) return { A: null, B: null, C: null };
  let A = null, B = null, C = null;
  for (const bt of raw?.eventBetTypes || []) {
    const name = bt.name || '';
    const nname = norm(name);
    // SLOT A : Double chance / X2
    if (nname === 'double chance') {
      for (const it of bt.eventBetTypeItems || []) {
        const sel = norm(it.shortName || it.name || '');
        const c = parseFloat(it.odds);
        if (isNaN(c) || c <= 1 || c >= 40) continue;
        if (sel === 'x2') {
          if (!A || c > A.odds) A = { book: 'congobet', market: name, selection: it.shortName || it.name, odds: c };
        }
      }
    }
    // SLOT B et C : Handicap européen "1 (0:1)" et "X (0:1)"
    if (nname === 'handicap europeen') {
      for (const it of bt.eventBetTypeItems || []) {
        const selRaw = it.shortName || it.name || '';
        const sel = norm(selRaw).replace(/\s+/g, '');
        const c = parseFloat(it.odds);
        if (isNaN(c) || c <= 1 || c >= 40) continue;
        // Chercher exactement "1 (0:1)" et "X (0:1)"
        if (sel === '1(0:1)') {
          if (!B || c > B.odds) B = { book: 'congobet', market: name, selection: selRaw, odds: c };
        } else if (sel === 'x(0:1)') {
          if (!C || c > C.odds) C = { book: 'congobet', market: name, selection: selRaw, odds: c };
        }
      }
    }
  }
  return { A, B, C };
}

async function extract1xbet(matchId) {
  const url = `${FEED}/service-api/LineFeed/GetGameZip?id=${matchId}&lng=fr&isSubGames=true&GroupEvents=true&countevents=2000&grMode=4&country=${COUNTRY}&marketType=1&isNewBuilder=true`;
  const raw = await viaWorker(url).catch(() => null);
  if (!raw) return { A: null, B: null, C: null };
  let A = null, B = null, C = null;
  for (const ge of raw?.Value?.GE || []) {
    // SLOT A : Double Chance (G=8) sélection T=6 (X2)
    if (ge.G === 8) {
      for (const sub of ge.E || []) {
        for (const it of (Array.isArray(sub) ? sub : [sub])) {
          if (it?.C == null) continue;
          const c = parseFloat(it.C);
          if (isNaN(c) || c <= 1 || c >= 40) continue;
          if (it.T === 6) {
            if (!A || c > A.odds) A = { book: '1xbet', market: 'Double Chance', selection: 'X2', odds: c };
          }
        }
      }
    }
    // SLOT B / C : European Handicap (G=1845) — 1xbet expose handicap européen ainsi
    // La ligne 0:1 correspond à P=1 pour away (spécifier). Non facilement reconnaissable.
    // On skip 1xbet pour B/C pour ne PAS se tromper.
  }
  return { A, B, C };
}

async function extract1win(matchId) {
  const raw = await fetchOddsWS([matchId], { timeoutMs: 20000, quietMs: 3000 }).catch(() => new Map());
  const data = raw.get(matchId) || raw.get(String(matchId)) || {};
  let A = null, B = null, C = null;
  for (const [groupName, oddsList] of Object.entries(data || {})) {
    const gn = norm(groupName);
    if (gn === 'double chance') {
      for (const o of oddsList || []) {
        if (!o || o.status !== 1) continue;
        const c = Number(o.cf);
        if (isNaN(c) || c <= 1 || c >= 40) continue;
        const sel = norm(o.name || '');
        if (sel === 'x2') {
          if (!A || c > A.odds) A = { book: '1win', market: 'Double Chance', selection: o.name, odds: c };
        }
      }
    }
    // 1win ne propose pas de "Handicap européen 0:1" identifiable de façon fiable → skip B/C
  }
  return { A, B, C };
}

const EXTRACT = {
  betpawa: extractBetpawa,
  congobet: extractCongobet,
  '1xbet': extract1xbet,
  '1win': extract1win,
};

// ─── Main ───────────────────────────────────────────────────────────────────
console.log('SCANNER PATTERN "LUZERN" — DC X2 + H eur 1(0:1) + H eur X(0:1)');
const catalogs = new Map();
for (const key of BOOKS) {
  const b = bookmakersByKey[key]; if (!b) continue;
  try {
    const ms = await b.listMatches({ live: false, sport: 'football', horizonHours: HORIZON_H });
    catalogs.set(key, ms);
    console.log(`[${key}] ${ms.length} matchs`);
  } catch (e) { console.log(`[${key}] KO`); }
}
const entries = alignCatalogs(catalogs, { minBooks: 2, horizonMs: Date.now() + HORIZON_H*3600*1000 });
console.log(`${entries.length} matchs alignés cross-book sur ${HORIZON_H}h`);
// Filtre : garde uniquement les TOP championnats
const filtered = entries.filter(e => isTopLeague(e.ref.league));
console.log(`${filtered.length} matchs après filtre TOP championnats`);
filtered.sort((a,b) => Object.keys(b.matches).length - Object.keys(a.matches).length);
const top = filtered.slice(0, TOP_MATCHES);
console.log(`\n${top.length} matchs à scanner (batch=${MATCH_BATCH})\n`);

async function processMatch(entry, idx) {
  const bookMatches = Object.entries(entry.matches).filter(([b]) => EXTRACT[b]);
  const results = await Promise.all(bookMatches.map(async ([book, m]) => {
    try { return { book, slots: await EXTRACT[book](m.id) }; }
    catch { return { book, slots: { A: null, B: null, C: null } }; }
  }));
  // Collecte tous les candidats par slot
  const A_all = [], B_all = [], C_all = [];
  for (const { slots } of results) {
    if (slots.A) A_all.push(slots.A);
    if (slots.B) B_all.push(slots.B);
    if (slots.C) C_all.push(slots.C);
  }
  // Meilleure cote par slot
  const A = A_all.sort((a,b) => b.odds - a.odds)[0];
  const B = B_all.sort((a,b) => b.odds - a.odds)[0];
  const C = C_all.sort((a,b) => b.odds - a.odds)[0];
  if (!A || !B || !C) {
    console.log(`[${idx+1}/${top.length}] ${entry.ref.home} vs ${entry.ref.away}  A=${A?A.odds:'?'} B=${B?B.odds:'?'} C=${C?C.odds:'?'}  → slot manquant, skip`);
    return null;
  }
  const sumInv = 1/A.odds + 1/B.odds + 1/C.odds;
  const profit = 1 - sumInv;
  const hint = profit > 0 ? `✅ ARB ${(profit*100).toFixed(2)}%` : `❌ ${(profit*100).toFixed(2)}%`;
  console.log(`[${idx+1}/${top.length}] ${entry.ref.home} vs ${entry.ref.away}  A=${A.odds}(${A.book}) B=${B.odds}(${B.book}) C=${C.odds}(${C.book})  Σ=${sumInv.toFixed(4)}  ${hint}`);
  return { entry, A, B, C, profit, sumInv };
}

const allOpps = [];
for (let b = 0; b < top.length; b += MATCH_BATCH) {
  const batch = top.slice(b, b + MATCH_BATCH).map((e, k) => processMatch(e, b + k));
  const results = await Promise.all(batch);
  for (const r of results) if (r && r.profit > 0) allOpps.push(r);
}
allOpps.sort((a,b) => b.profit - a.profit);

// ─── Rapport ────────────────────────────────────────────────────────────────
let md = `# Scan Pattern "Luzern" — DC X2 + H eur 1(0:1) + H eur X(0:1)\n\nGénéré: ${new Date().toISOString()}\n`;
md += `Matchs scannés : ${top.length} sur ${HORIZON_H}h\n\n`;
md += `## 🎯 Arbitrages trouvés : ${allOpps.length}\n\n`;
if (allOpps.length === 0) {
  md += `Aucun arb rentable trouvé.\n`;
} else {
  for (const [i, o] of allOpps.slice(0, 30).entries()) {
    const stakeA = BANKROLL * (1/o.A.odds) / o.sumInv;
    const stakeB = BANKROLL * (1/o.B.odds) / o.sumInv;
    const stakeC = BANKROLL * (1/o.C.odds) / o.sumInv;
    const retour = BANKROLL / o.sumInv;
    md += `\n### #${i+1} — PROFIT **${(o.profit*100).toFixed(2)}%** — ${o.entry.ref.home} vs ${o.entry.ref.away}\n\n`;
    md += `Ligue : ${o.entry.ref.league || '?'} | Kickoff : ${o.entry.ref.start ? new Date(o.entry.ref.start).toISOString() : '?'}\n\n`;
    md += `Bankroll 100 000 XOF → **retour garanti ${retour.toFixed(0)} XOF (+${(retour-BANKROLL).toFixed(0)})**\n\n`;
    md += `| # | Book | Marché | Sélection | Cote | Mise |\n|---|---|---|---|---:|---:|\n`;
    md += `| A | **${o.A.book}** | \`${o.A.market}\` | \`${o.A.selection}\` (X2, Draw ∪ Away) | ${o.A.odds.toFixed(2)} | ${stakeA.toFixed(0)} XOF |\n`;
    md += `| B | **${o.B.book}** | \`${o.B.market}\` | \`${o.B.selection}\` (Home wins by 2+) | ${o.B.odds.toFixed(2)} | ${stakeB.toFixed(0)} XOF |\n`;
    md += `| C | **${o.C.book}** | \`${o.C.market}\` | \`${o.C.selection}\` (Home wins by exactly 1) | ${o.C.odds.toFixed(2)} | ${stakeC.toFixed(0)} XOF |\n`;
    md += `\nΣ 1/cotes = 1/${o.A.odds.toFixed(2)} + 1/${o.B.odds.toFixed(2)} + 1/${o.C.odds.toFixed(2)} = ${o.sumInv.toFixed(4)}\n`;
  }
}

mkdirSync('docs', { recursive: true });
writeFileSync('docs/luzern-pattern-scan.md', md);
console.log(`\n═══ ${allOpps.length} arbs trouvés — docs/luzern-pattern-scan.md ═══`);
if (allOpps.length > 0) {
  console.log(`Top :`);
  for (const o of allOpps.slice(0, 10)) console.log(`  ${(o.profit*100).toFixed(2)}% — ${o.entry.ref.home} vs ${o.entry.ref.away}`);
}
process.exit(0);
