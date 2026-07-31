// Audit 1win football : liste 2 matchs, dump tous les groupes + parseur output.
// Objectif : identifier les groups "team totals" mal parsés + les groups non mappés utiles.
import { listPrematch } from '../src/bookmakers/onewin/list.js';
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';
import { winFlatOdds } from '../src/bookmakers/onewin/parse.js';

console.log('=== 1WIN FOOTBALL AUDIT ===\n');

const matches = await listPrematch('football');
console.log(`Total football matches: ${matches.length}`);
if (!matches.length) { console.log('NO MATCHES — abort'); process.exit(0); }

// Pick 2 matches distributed across time
const now = Date.now();
const upcoming = matches.filter(m => m.start && m.start > now).sort((a,b) => a.start - b.start);
const picks = [upcoming[0], upcoming[Math.floor(upcoming.length / 2)]].filter(Boolean);
console.log(`Picks: ${picks.length}`);

const ids = picks.map(p => p.id);
const rawMap = await fetchOddsWS(ids, { timeoutMs: 30_000, quietMs: 8_000 });

const allGroupNames = new Map(); // groupName → { count, sample_names: [], sample_outcomes: [] }
for (const [i, m] of picks.entries()) {
  console.log(`\n─── MATCH ${i+1}/${picks.length} : ${m.home} vs ${m.away} [${m.league}] ${m.start ? new Date(m.start).toISOString() : ''} ───`);
  const groups = rawMap.get(m.id) || rawMap.get(String(m.id));
  if (!groups) { console.log('  NO ODDS'); continue; }
  const groupNames = Object.keys(groups);
  console.log(`  Groups: ${groupNames.length}`);
  for (const gn of groupNames.sort()) {
    const list = groups[gn] || [];
    const active = list.filter(o => o?.status === 1 && Number(o.cf) > 1);
    const inact = list.length - active.length;
    if (!active.length && inact === 0) continue;
    const names = active.slice(0, 6).map(o => `${o.name || ''}${o.outcome ? `[${o.outcome}]` : ''}@${o.cf}`).join(' | ');
    console.log(`    "${gn}" (${active.length}a/${list.length}t): ${names}${active.length > 6 ? ` ...+${active.length - 6}` : ''}`);
    if (!allGroupNames.has(gn)) allGroupNames.set(gn, { count: 0, sample_events: [] });
    const agg = allGroupNames.get(gn);
    agg.count++;
    if (agg.sample_events.length < 3) {
      for (const o of active.slice(0, 3)) agg.sample_events.push({ name: o.name, outcome: o.outcome, cf: o.cf });
    }
  }
  const parsed = winFlatOdds(groups, { home: m.home, away: m.away });
  const keys = Object.keys(parsed);
  console.log(`\n  Parseur: ${keys.length} cotes`);
  console.log(`    ${keys.sort().join(', ')}`);
}

console.log('\n\n=== SYNTHESE GROUPES ===');
for (const [gn, info] of [...allGroupNames.entries()].sort((a,b) => a[0].localeCompare(b[0]))) {
  const sample = info.sample_events.slice(0, 3).map(e => `${e.name || ''}[${e.outcome || ''}]@${e.cf}`).join(' | ');
  console.log(`  "${gn}" x${info.count}: ${sample}`);
}
console.log(`\nTotal groupes uniques: ${allGroupNames.size}`);
process.exit(0);
