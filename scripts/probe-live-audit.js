#!/usr/bin/env node
// PROBE LIVE AUDIT — pour un match live donne (search par nom equipe), fetch
// les cotes brutes de CHAQUE bookmaker qui l'expose, dump la reponse brute
// complete + les odds parsees, attend 8s, re-fetch pour detecter les cotes
// figees (stale). Objectif : identifier quel(s) book(s) renvoient des marches
// suspendus avec dernier prix fige (cause probable des fake arbs live).
//
// Usage :
//   MATCH_SEARCH="Krumvir" SPORT=football node scripts/probe-live-audit.js
//   MATCH_SEARCH="Grimsby" SPORT=football node scripts/probe-live-audit.js
//
// Sortie : dump JSON par book (raw + parsed), + tableau diff apres 8s.
import bookmakers from '../src/bookmakers/index.js';

const SEARCH = (process.env.MATCH_SEARCH || '').trim();
const SPORT = (process.env.SPORT || 'football').trim();
const WAIT_MS = Number(process.env.WAIT_MS || 8000);

if (!SEARCH) {
  console.error('MATCH_SEARCH requis (ex: "Krumvir", "Grimsby", "SK Krumvir")');
  process.exit(1);
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const matches = (m, q) => norm(m.home).includes(norm(q)) || norm(m.away).includes(norm(q));

console.log(`▶ PROBE LIVE AUDIT — search="${SEARCH}" sport=${SPORT} wait=${WAIT_MS}ms`);
console.log(`  Books testes : ${bookmakers.map(b => b.key).join(', ')}`);
console.log('');

// Etape 1 : lister les matchs live de chaque book, trouver ceux qui matchent
const perBook = {};
await Promise.all(bookmakers.filter(b => b.supports.live).map(async (b) => {
  try {
    const list = await b.listMatches({ live: true, sport: SPORT });
    const found = (list || []).filter(m => matches(m, SEARCH));
    perBook[b.key] = { book: b, list: found };
    console.log(`[${b.key}] live catalog=${list?.length || 0} matched=${found.length}${found.length ? ' → ' + found.map(m => `${m.home} vs ${m.away} (id=${m.id})`).join(' | ') : ''}`);
  } catch (e) {
    console.log(`[${b.key}] listMatches ERR : ${e.message}`);
    perBook[b.key] = { book: b, list: [] };
  }
}));

const booksWithMatch = Object.entries(perBook).filter(([, v]) => v.list.length > 0);
if (!booksWithMatch.length) {
  console.log(`\n❌ Aucun book ne trouve le match "${SEARCH}" en live. Retry avec un autre nom.`);
  process.exit(0);
}

console.log(`\n══════════════════════════════════════════════════════════`);
console.log(`ETAPE 1 : fetch odds initial pour ${booksWithMatch.length} books`);
console.log(`══════════════════════════════════════════════════════════`);

const T1 = {};
for (const [key, { book, list }] of booksWithMatch) {
  const m = list[0];
  const t0 = Date.now();
  try {
    const odds = await book.getOdds(m, { live: true, noCache: true, sport: SPORT });
    const dt = Date.now() - t0;
    T1[key] = { match: m, odds, dt };
    const keys = Object.keys(odds || {}).sort();
    console.log(`\n[${key}] match="${m.home} vs ${m.away}" live=${JSON.stringify(m.live || null)} fetch=${dt}ms markets=${keys.length}`);
    // Print cles hcp/match/total prioritaires (celles qui font le plus de fake arbs)
    const focus = keys.filter(k => /^(match_[12X]|hcp_|dc_|dnb_|match_over|match_under|btts|odd|even|ht_match|ht_over|ht_under)/.test(k));
    for (const k of focus.sort()) console.log(`  ${k.padEnd(30)} = ${odds[k]}`);
    if (keys.length && focus.length < keys.length) console.log(`  ... (${keys.length - focus.length} autres cles omises pour lisibilite)`);
  } catch (e) {
    console.log(`[${key}] getOdds ERR : ${e.message}`);
    T1[key] = { match: m, odds: {}, dt: Date.now() - t0, err: e.message };
  }
}

console.log(`\n══════════════════════════════════════════════════════════`);
console.log(`ETAPE 2 : attente ${WAIT_MS}ms puis re-fetch fresh`);
console.log(`══════════════════════════════════════════════════════════`);
await new Promise(r => setTimeout(r, WAIT_MS));

const T2 = {};
for (const [key, { book, list }] of booksWithMatch) {
  const m = list[0];
  const t0 = Date.now();
  try {
    const odds = await book.getOdds(m, { live: true, noCache: true, sport: SPORT });
    T2[key] = { odds, dt: Date.now() - t0 };
  } catch (e) {
    T2[key] = { odds: {}, dt: Date.now() - t0, err: e.message };
  }
}

console.log(`\n══════════════════════════════════════════════════════════`);
console.log(`DIFF T1 → T2 (apres ${WAIT_MS}ms) — cotes IDENTIQUES = suspect stale`);
console.log(`══════════════════════════════════════════════════════════`);
for (const [key] of booksWithMatch) {
  const o1 = T1[key]?.odds || {};
  const o2 = T2[key]?.odds || {};
  const allKeys = new Set([...Object.keys(o1), ...Object.keys(o2)]);
  let changed = 0, identical = 0, added = 0, removed = 0;
  const changes = [];
  for (const k of allKeys) {
    if (o1[k] == null && o2[k] != null) { added++; continue; }
    if (o1[k] != null && o2[k] == null) { removed++; changes.push(`  ⚠️ REMOVED ${k}: ${o1[k]}`); continue; }
    if (o1[k] === o2[k]) identical++;
    else { changed++; changes.push(`  Δ ${k}: ${o1[k]} → ${o2[k]}`); }
  }
  const staleRatio = identical / Math.max(1, identical + changed);
  const flag = staleRatio > 0.95 && identical > 5 ? '🚨 SUSPECT STALE' : staleRatio > 0.80 && identical > 5 ? '⚠️ mostly stale' : '✅ dynamic';
  console.log(`\n[${key}] ${flag} — identical=${identical} changed=${changed} added=${added} removed=${removed} (staleRatio=${(staleRatio * 100).toFixed(0)}%)`);
  if (changes.length && changes.length < 15) for (const c of changes) console.log(c);
  else if (changes.length) console.log(`  (${changes.length} changements, top 5 :)`), changes.slice(0, 5).forEach(c => console.log(c));
}

console.log(`\n══════════════════════════════════════════════════════════`);
console.log(`CROSS-BOOK : cote pour meme cle entre books`);
console.log(`══════════════════════════════════════════════════════════`);
const allKeys = new Set();
for (const key of Object.keys(T1)) for (const k of Object.keys(T1[key].odds || {})) allKeys.add(k);
const focusKeys = [...allKeys].filter(k => /^(match_[12X]|hcp_home_-?\d|hcp_away_-?\d|match_over_\d|match_under_\d|btts|odd|even)/.test(k)).sort();
for (const k of focusKeys) {
  const line = Object.entries(T1).map(([key, v]) => v.odds[k] != null ? `${key}=${v.odds[k]}` : null).filter(Boolean);
  if (line.length >= 2) console.log(`  ${k.padEnd(28)} ${line.join(' | ')}`);
}

console.log('\n✅ probe termine — verifier sur chaque site les cotes REELLES vs celles ci-dessus.');
process.exit(0);
