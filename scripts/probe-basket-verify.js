#!/usr/bin/env node
// AUDIT MAPPING — pour chaque book x sport (tennis + basket), pick 3 matchs
// riches en marches, lance le parseur, et dump :
//   - toutes les lignes handicap detectees (home + away, meme signe)
//   - tous les totaux (over + under, meme ligne)
//   - tous les totaux individuels TT (home + away)
//   - toutes les cles winner / period winner / odd/even
//
// Objectif : identifier
//   1) Handicaps orphelins (parser sort hcp_home_-5.5 mais PAS hcp_away_+5.5)
//   2) Totaux orphelins (over sans under)
//   3) Cles avec valeur suspecte (odds >20 = cote gelee / 1x tag)
//   4) Ecarts entre 2 books sur meme ligne (pour reperer bug sign flip)
//
// User verifie ensuite sur le site du book : la cote qu'il voit doit matcher
// ce que notre parseur a extrait pour chaque marche.
import { bookmakers } from '../src/bookmakers/index.js';

const SPORTS = ['tennis', 'basket'];
const SAMPLES_PER_BOOK = 2;
const bookByKey = Object.fromEntries(bookmakers.map(b => [b.key, b]));

function classify(key) {
  if (/^(?:[qhs][1-5]_)?match_[12X]$/.test(key)) return 'winner';
  if (/^(?:[qhs][1-5]_)?hcp_(home|away)_/.test(key)) return 'handicap';
  if (/^(?:[qhs][1-5]_)?tt_(home|away)_(over|under)_/.test(key)) return 'tt';
  if (/^(?:[qhs][1-5]_)?match_?(over|under)_/.test(key) || /^(?:[qhs][1-5]_)?(over|under)_/.test(key) || /^(?:[qhs][1-5]_)?total_sets_(over|under)_/.test(key)) return 'total';
  if (/^(?:[qhs][1-5]_)?(odd|even)$/.test(key)) return 'oddeven';
  if (/^(?:[qhs][1-5]_)?dc_|dnb_|btts_/.test(key)) return 'other';
  return 'other';
}

function extractLine(key) {
  const m = key.match(/(-?\d+(?:\.\d+)?)$/);
  return m ? parseFloat(m[1]) : null;
}

function extractPrefix(key) {
  const m = key.match(/^([qhs][1-5]_)/);
  return m ? m[1] : '';
}

// Group les cles par (prefix + type + line) pour reperer les paires manquantes
function groupOddsForAudit(odds) {
  const groups = { winner: {}, handicap: {}, total: {}, tt: {}, oddeven: {}, other: {} };
  for (const [k, v] of Object.entries(odds)) {
    if (k === '_ids') continue;
    const cat = classify(k);
    const pfx = extractPrefix(k);
    if (cat === 'handicap') {
      const line = extractLine(k);
      const side = /hcp_home/.test(k) ? 'home' : 'away';
      // CANONICALISATION home-perspective : les paires complementaires sont
      // home_-L ↔ away_+L (signes opposes). Regroupe sur le line "home-vu"
      // pour que la paire correcte se retrouve dans le meme bucket.
      const canonicalLine = side === 'home' ? line : -line;
      const bucket = `${pfx}hcp_${canonicalLine}`;
      groups.handicap[bucket] = groups.handicap[bucket] || {};
      groups.handicap[bucket][side] = { key: k, odd: v };
    } else if (cat === 'total') {
      const line = extractLine(k);
      const dir = /(?:^|_)over/.test(k) ? 'over' : 'under';
      const bucket = `${pfx}total_${line}`;
      groups.total[bucket] = groups.total[bucket] || {};
      groups.total[bucket][dir] = { key: k, odd: v };
    } else if (cat === 'tt') {
      const line = extractLine(k);
      const side = /tt_home/.test(k) ? 'home' : 'away';
      const dir = /over_/.test(k) ? 'over' : 'under';
      const bucket = `${pfx}tt_${side}_${line}`;
      groups.tt[bucket] = groups.tt[bucket] || {};
      groups.tt[bucket][dir] = { key: k, odd: v };
    } else if (cat === 'winner') {
      groups.winner[k] = v;
    } else if (cat === 'oddeven') {
      groups.oddeven[k] = v;
    } else {
      groups.other[k] = v;
    }
  }
  return groups;
}

function auditGroups(groups) {
  const issues = [];
  // Handicaps : hcp_home_+X doit avoir hcp_away_-X en pendant (paire logique)
  // Notre convention : hcp_home_L existe sans forcement hcp_away_-L (le book
  // peut n'exposer qu'un cote). Le probleme est quand DEUX cotes sont sur la
  // meme ligne (ex: home_-2.5 + away_-2.5 = incoherence, devrait etre away_+2.5).
  for (const [bucket, sides] of Object.entries(groups.handicap)) {
    if (sides.home && sides.away) {
      // OK : 2 cotes memes ligne = c'est correct si convention respectee
      // (leur somme inverse doit etre >= 1 - marge)
      const invSum = 1 / sides.home.odd + 1 / sides.away.odd;
      if (invSum < 0.85) issues.push(`HCP suspicious ${bucket}: 1/${sides.home.odd}+1/${sides.away.odd}=${invSum.toFixed(3)} <0.85 (rare — cotes desynchronisees ou bug convention)`);
    }
    // OK single-side
  }
  // Totaux : over sans under = degrade mais pas fatal (le parseur peut manquer un cote)
  // Meme test invSum : over_X + under_X doit etre >= 1 - marge
  for (const [bucket, sides] of Object.entries(groups.total)) {
    if (sides.over && sides.under) {
      const invSum = 1 / sides.over.odd + 1 / sides.under.odd;
      if (invSum < 0.85) issues.push(`TOT suspicious ${bucket}: over=${sides.over.odd} under=${sides.under.odd} sum=${invSum.toFixed(3)}`);
    }
  }
  // Cotes >20 sur tout marche = suspect (cote gelee / bug)
  for (const cat of ['handicap', 'total', 'tt']) {
    for (const sides of Object.values(groups[cat])) {
      for (const s of Object.values(sides)) {
        if (s.odd > 20) issues.push(`${cat.toUpperCase()} suspicious high odd: ${s.key}=${s.odd}`);
      }
    }
  }
  return issues;
}

function summary(groups) {
  const winCount = Object.keys(groups.winner).length;
  const hcpFull = Object.values(groups.handicap).filter(g => g.home && g.away).length;
  const hcpPartial = Object.values(groups.handicap).length - hcpFull;
  const totFull = Object.values(groups.total).filter(g => g.over && g.under).length;
  const totPartial = Object.values(groups.total).length - totFull;
  const ttFull = Object.values(groups.tt).filter(g => g.over && g.under).length;
  const ttPartial = Object.values(groups.tt).length - ttFull;
  const oe = Object.keys(groups.oddeven).length;
  return `winner:${winCount} hcp:${hcpFull}full/${hcpPartial}partial tot:${totFull}full/${totPartial}partial tt:${ttFull}full/${ttPartial}partial oe:${oe}`;
}

function dumpHcp(groups, maxRows = 10) {
  const buckets = Object.keys(groups.handicap).sort((a, b) => {
    const la = parseFloat(a.match(/-?\d+(?:\.\d+)?$/)[0]);
    const lb = parseFloat(b.match(/-?\d+(?:\.\d+)?$/)[0]);
    return la - lb;
  });
  const rows = [];
  for (const b of buckets.slice(0, maxRows)) {
    const g = groups.handicap[b];
    rows.push(`      ${b.padEnd(20)} home=${g.home?.odd ?? '-'.padStart(5)} away=${g.away?.odd ?? '-'.padStart(5)}`);
  }
  return rows.join('\n');
}

function dumpTot(groups, maxRows = 10) {
  const buckets = Object.keys(groups.total).sort((a, b) => {
    const la = parseFloat(a.match(/-?\d+(?:\.\d+)?$/)[0]);
    const lb = parseFloat(b.match(/-?\d+(?:\.\d+)?$/)[0]);
    return la - lb;
  });
  const rows = [];
  for (const b of buckets.slice(0, maxRows)) {
    const g = groups.total[b];
    rows.push(`      ${b.padEnd(24)} over=${g.over?.odd ?? '-'.padStart(5)} under=${g.under?.odd ?? '-'.padStart(5)}`);
  }
  return rows.join('\n');
}

// ═══════════════════════════ MAIN ═══════════════════════════
console.log('▶ AUDIT MAPPING — tennis + basket par bookmaker\n');

for (const sport of SPORTS) {
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`═══════════════════════════ ${sport.toUpperCase()} ══════════════════════════`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  for (const b of bookmakers) {
    if (b.key === 'apollo' && sport === 'basket') { console.log(`── ${b.label} (basket non supporte) SKIP\n`); continue; }
    if (b.key === 'yellowbet' && sport === 'tennis') { console.log(`── ${b.label} (tennis non supporte) SKIP\n`); continue; }
    console.log(`──────────────────────── ${b.label} (${b.key}) ────────────────────────`);
    let matches = [];
    try {
      matches = await b.listMatches({ live: false, horizonHours: 72, sport });
    } catch (e) { console.log(`  ⚠️ listMatches erreur: ${e.message}\n`); continue; }
    if (!matches.length) { console.log(`  ⚠️ 0 matchs\n`); continue; }
    // Pick les 2 matchs avec le plus de markets embarques
    const sortedMatches = matches
      .map(m => ({ m, cnt: (m.__raw?.markets?.length ?? 0) + (m.__raw?.marketGroups?.reduce((s, g) => s + (g.markets?.length || 0), 0) ?? 0) }))
      .sort((a, b) => b.cnt - a.cnt)
      .slice(0, SAMPLES_PER_BOOK);
    for (const { m } of sortedMatches) {
      console.log(`\n  ▶ ${m.home} vs ${m.away}  [${m.league || '?'}]  id=${m.id}`);
      let odds = {};
      try {
        odds = await b.getOdds(m, { live: false, noCache: true, sport });
      } catch (e) { console.log(`    ⚠️ getOdds erreur: ${e.message}`); continue; }
      const groups = groupOddsForAudit(odds);
      console.log(`    ${summary(groups)}`);
      if (Object.keys(groups.winner).length) {
        console.log(`    WINNER : ${Object.entries(groups.winner).map(([k, v]) => `${k}=${v}`).join('  ')}`);
      }
      if (Object.keys(groups.handicap).length) {
        console.log(`    HANDICAPS :`);
        console.log(dumpHcp(groups, 15));
      }
      if (Object.keys(groups.total).length) {
        console.log(`    TOTALS :`);
        console.log(dumpTot(groups, 15));
      }
      if (Object.keys(groups.tt).length) {
        console.log(`    TT indiv : ${Object.keys(groups.tt).length} lignes`);
      }
      const issues = auditGroups(groups);
      if (issues.length) {
        console.log(`    🚨 ISSUES DETECTEES (${issues.length}) :`);
        for (const iss of issues.slice(0, 8)) console.log(`      ${iss}`);
      }
    }
    console.log('');
  }
}
console.log('\n═══ FIN AUDIT — verifie sur le site du book quelques handicaps affiches ci-dessus ═══');
