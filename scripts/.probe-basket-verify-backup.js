#!/usr/bin/env node
// PROBE BASKET VERIFY — reproduit ce que le scanner detecte pour le basket
// prematch, puis pour chaque opp du top-N re-fetch les cotes RAW de chaque
// book impliquee et dump :
//   - la cle exacte utilisee dans l'arbitrage (ex: hcp_home_-4.5)
//   - la cote lue par notre parseur (leg_a_odd / leg_b_odd)
//   - le RAW du market correspondant depuis la reponse API brute
//   - l'URL de verification (site bookmaker)
//
// Objectif : identifier si un parseur mappe une cle sur la mauvaise cote (bug
// classique : la ligne du handicap est mal extraite du specifier, ou la
// direction over/under est inversee, ou home/away est confondu).
//
// Usage : node scripts/probe-basket-verify.js [TOP_N=8]
import { bookmakers } from '../src/bookmakers/index.js';
import { runScan } from '../src/scanners/collect.js';

const TOP_N = Number(process.argv[2] || 8);
const bookByKey = Object.fromEntries(bookmakers.map(b => [b.key, b]));

console.log(`▶ PROBE BASKET VERIFY — lance un scan basket prematch et cross-check les top ${TOP_N} opps\n`);

const result = await runScan({ live: false, sport: 'basket', minProfit: 0.5, horizonHours: 72 });
const opps = (result.opportunities || []).slice(0, TOP_N);
console.log(`\n✅ ${result.opportunities?.length || 0} opps confirmees — analyse des top ${opps.length}\n`);

if (!opps.length) {
  console.log('❌ Aucune opp basket → rien a verifier. Retry dans quelques minutes.');
  process.exit(0);
}

// Helper : recherche dans les cotes brutes le market qui correspond a la cle.
// Retourne le market brut (JSON stringify tronque) et la cote cotesRAW extraite.
function findRawMarketForKey(rawResponse, key, book) {
  // On sait quelle cle on cherche (ex: hcp_home_-4.5, match_over_218.5).
  // On serialise le raw pour permettre au user de retrouver le market a l'oeil
  // dans la reponse API du book.
  try {
    const s = JSON.stringify(rawResponse);
    // Cherche l'occurrence de la ligne dans le RAW (si applicable)
    const line = key.match(/(-?\d+(?:\.\d+)?)$/)?.[1];
    if (line) {
      const idx = s.indexOf(`"${line}"`);
      if (idx > -1) return `...${s.slice(Math.max(0, idx - 80), idx + 200)}...`;
    }
  } catch { /* ignore */ }
  return '(pas trouve dans raw)';
}

// Pour chaque book, on ajoute un accesseur au RAW brut de sa reponse odds.
// On patch chaque book pour capturer temporairement la reponse RAW.
const rawCaptures = new Map(); // book:matchId -> raw response
for (const b of bookmakers) {
  if (b.key === '1xbet' || b.key === 'sportybet' || b.key === 'betmomo' || b.key === '1win' || b.key === 'betpawa') {
    // Wrap getOdds pour capturer le retour (odds parsees) — on ne peut pas
    // easily wrap plus profond sans toucher aux modules. On dump donc juste
    // les odds parsees pour l'instant. Le raw HTTP dump necessite une trace
    // dediee par bookmaker (voir workflow separe si besoin).
  }
}

// Pour CHAQUE opp du top, re-fetch les cotes fresh des 2 books et dump tout.
for (let i = 0; i < opps.length; i++) {
  const o = opps[i];
  const { a: keyA, b: keyB } = deriveKeyPair(o);
  console.log(`═════════════════════════════════════════════════════════════════`);
  console.log(`OPP #${i + 1}  profit=${o.profit_pct}%  ${o.market_family}`);
  console.log(`  match: ${o.team_home_full || o.team_home} vs ${o.team_away_full || o.team_away}`);
  console.log(`  league: ${o.league || '?'}   kickoff: ${o.kickoff_iso || '?'}`);
  console.log(`  leg_a: ${o.leg_a_book}  ${o.leg_a_label} @ ${o.leg_a_odd}   → key ${keyA || '?'}`);
  console.log(`  leg_b: ${o.leg_b_book}  ${o.leg_b_label} @ ${o.leg_b_odd}   → key ${keyB || '?'}`);
  console.log(`  inverse_sum = 1/${o.leg_a_odd} + 1/${o.leg_b_odd} = ${(1 / o.leg_a_odd + 1 / o.leg_b_odd).toFixed(4)}`);
  console.log(`  IDs match : ${JSON.stringify(idsFromOpp(o))}`);

  // Re-fetch fresh odds pour chaque book impliquee AVEC SA cle attendue.
  for (const [bookKey, expectedKey, expectedOdd] of [
    [o.leg_a_book, keyA, o.leg_a_odd],
    [o.leg_b_book, keyB, o.leg_b_odd],
  ]) {
    const book = bookByKey[bookKey];
    if (!book) continue;
    const m = matchFromOpp(o, bookKey);
    if (!m) { console.log(`  ⚠️ ${bookKey} : match introuvable dans catalog`); continue; }
    try {
      const odds = await book.getOdds(m, { live: false, noCache: true, sport: 'basket' });
      const relevantKeys = Object.keys(odds || {}).filter(k => keyMatchesFamily(k, o.market_family));
      console.log(`  ── ${bookKey} fresh (match id=${m.id}) : ${Object.keys(odds).length} cles totales, ${relevantKeys.length} liees a "${o.market_family}"`);
      for (const k of relevantKeys.sort()) console.log(`     ${k.padEnd(35)} = ${odds[k]}`);
      // Cross-check cote envoyee vs fresh sur la BONNE cle miroir.
      if (expectedKey && odds[expectedKey] != null) {
        const fresh = odds[expectedKey];
        const drift = Math.abs(fresh - expectedOdd);
        const flag = drift < 0.001 ? '✅ IDENTIQUE' : drift < 0.20 ? '~ drift acceptable' : `🚨 DIVERGENT (drift=${drift.toFixed(2)})`;
        console.log(`     ➜ ${expectedKey.padEnd(30)} envoye=${expectedOdd}  fresh=${fresh}  ${flag}`);
      } else if (expectedKey) {
        console.log(`     🚨 MANQUANT : cle ${expectedKey} envoyee (@${expectedOdd}) mais ABSENTE du re-fetch → cote peut-etre disparue OU parseur inconsistant`);
      }
    } catch (e) {
      console.log(`  ⚠️ ${bookKey} getOdds ERR : ${e.message} ${e.stack?.split('\n').slice(1, 3).join(' | ') || ''}`);
    }
  }
  console.log('');
}

console.log(`\nFin du probe. Verifier manuellement 1-2 opps sur le site du bookmaker :`);
console.log(`  - la cote affichee sur le site doit matcher "envoye=" ET "fresh=" ci-dessus`);
console.log(`  - si "envoye" != "fresh" >> 0.20 : bug parseur ou cotes qui bougent tres vite`);
console.log(`  - si "envoye" != site : bug mapping (cle envoyee mais mauvaise cote lue)`);
process.exit(0);

// ═════════════════════════════ helpers ═════════════════════════════

// Deduit la cle utilisee par le comparator depuis la market_family + labels.
// Ex: "Handicap Points -4.5" leg_a_label="Dom. -4.5" leg_b_label="Ext. +4.5"
//   → si leg_a_book contient hcp_home_-4.5 = leg_a_odd → key envoye
function deriveKey(o) {
  const fam = String(o.market_family || '');
  const legA = String(o.leg_a_label || '');
  const legB = String(o.leg_b_label || '');

  // Vainqueur : match_1 / match_2
  if (/^Vainqueur du Match$/.test(fam)) return legA.includes('Dom') ? 'match_1' : 'match_2';
  if (/Vainqueur$/.test(fam)) {
    const pfx = periodPfx(fam);
    return `${pfx}match_${legA.includes('Dom') ? '1' : '2'}`;
  }

  // Handicap Points ±L
  let m = fam.match(/^Handicap Points\s+([+-]?\d+(?:\.\d+)?)$/);
  if (m) return legA.includes('Dom') ? `hcp_home_${m[1]}` : `hcp_away_${m[1]}`;
  m = fam.match(/^(\w+) Handicap\s+([+-]?\d+(?:\.\d+)?)$/);
  if (m) {
    const pfx = periodPfx(m[1] + ' _');
    return `${pfx}hcp_${legA.includes('Dom') ? 'home' : 'away'}_${m[2]}`;
  }

  // Total Points Match X
  m = fam.match(/^Total Points Match\s+(\d+(?:\.\d+)?)$/);
  if (m) return legA.includes('+') ? `match_over_${m[1]}` : `match_under_${m[1]}`;
  m = fam.match(/^(\w+) Total Points\s+(\d+(?:\.\d+)?)$/);
  if (m) {
    const pfx = periodPfx(m[1] + ' _');
    return `${pfx}${legA.includes('+') ? 'over' : 'under'}_${m[2]}`;
  }

  // Total Points Dom./Ext. X
  m = fam.match(/^Total Points (Dom|Ext)\.\s+(\d+(?:\.\d+)?)$/);
  if (m) {
    const side = m[1] === 'Dom' ? 'home' : 'away';
    return `tt_${side}_${legA.includes('+') ? 'over' : 'under'}_${m[2]}`;
  }

  // Odd/Even
  if (/Pair\/Impair Points/.test(fam)) return legA.includes('Impair') ? 'odd' : 'even';
  return null;
}

function periodPfx(fam) {
  if (/\bQ1\b/.test(fam)) return 'q1_';
  if (/\bQ2\b/.test(fam)) return 'q2_';
  if (/\bQ3\b/.test(fam)) return 'q3_';
  if (/\bQ4\b/.test(fam)) return 'q4_';
  if (/\b1MT\b/.test(fam)) return 'h1_';
  if (/\b2MT\b/.test(fam)) return 'h2_';
  return '';
}

// Est-ce que la cle est liee a la market_family (pour filtrer l'affichage) ?
// Match tres large : n'importe quelle cle qui partage le prefixe periode+type.
function keyMatchesFamily(k, family) {
  const fam = String(family || '');
  const pfx = periodPfx(fam);
  // Vainqueur : match_1/2/X eventuellement prefixe
  if (/Vainqueur/.test(fam)) return new RegExp(`^${pfx}match_[12X]$`).test(k);
  // Handicap Points ou XX Handicap
  if (/Handicap/.test(fam)) return new RegExp(`^${pfx}hcp_(home|away)_-?\\d`).test(k);
  // Total Points Match / QX Total Points / TT Dom/Ext
  if (/Total Points Match|MT Total Points|Q[1-4] Total Points$/.test(fam)) return new RegExp(`^${pfx}(match_)?(over|under)_\\d`).test(k);
  if (/Total Points (Dom|Ext)/.test(fam)) return new RegExp(`^${pfx}tt_`).test(k);
  if (/Pair\/Impair/.test(fam)) return new RegExp(`^${pfx}(odd|even)$`).test(k);
  return false;
}

// Genere les 2 cles miroirs (une par leg) pour verification cross-book.
function deriveKeyPair(o) {
  const key = deriveKey(o);
  if (!key) return { a: null, b: null };
  // Cles miroirs : match_1 ↔ match_2, hcp_home_L ↔ hcp_away_-L, over_L ↔ under_L
  let mirror = key;
  if (/match_1$/.test(key)) mirror = key.replace(/match_1$/, 'match_2');
  else if (/match_2$/.test(key)) mirror = key.replace(/match_2$/, 'match_1');
  else if (/hcp_home_(-?\d+(?:\.\d+)?)$/.test(key)) {
    const m = key.match(/hcp_home_(-?\d+(?:\.\d+)?)$/);
    mirror = key.replace(/hcp_home_-?\d+(?:\.\d+)?$/, `hcp_away_${-parseFloat(m[1])}`);
  }
  else if (/hcp_away_(-?\d+(?:\.\d+)?)$/.test(key)) {
    const m = key.match(/hcp_away_(-?\d+(?:\.\d+)?)$/);
    mirror = key.replace(/hcp_away_-?\d+(?:\.\d+)?$/, `hcp_home_${-parseFloat(m[1])}`);
  }
  else if (/over_(\d+(?:\.\d+)?)$/.test(key)) mirror = key.replace('over_', 'under_');
  else if (/under_(\d+(?:\.\d+)?)$/.test(key)) mirror = key.replace('under_', 'over_');
  else if (/odd$/.test(key)) mirror = key.replace(/odd$/, 'even');
  else if (/even$/.test(key)) mirror = key.replace(/even$/, 'odd');
  return { a: key, b: mirror };
}

function idsFromOpp(o) {
  return {
    onexbet: o.onexbet_match_id, onewin: o.onewin_match_id,
    betmomo: o.betmomo_match_id, betpawa: o.betpawa_match_id,
    sportybet: o.sportybet_match_id,
  };
}

// Reconstruit un match minimal pour re-fetch les cotes du book.
function matchFromOpp(o, bookKey) {
  const idField = {
    '1xbet': 'onexbet_match_id', '1win': 'onewin_match_id',
    'betmomo': 'betmomo_match_id', 'betpawa': 'betpawa_match_id',
    'sportybet': 'sportybet_match_id',
  }[bookKey];
  const id = idField ? o[idField] : null;
  if (id == null) return null;
  return {
    id: String(id),
    home: o.team_home_full || o.team_home,
    away: o.team_away_full || o.team_away,
    league: o.league || '',
    start: o.kickoff_iso ? new Date(o.kickoff_iso).getTime() : null,
  };
}
