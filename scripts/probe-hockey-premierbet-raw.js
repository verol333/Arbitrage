#!/usr/bin/env node
// PROBE PremierBet hockey RAW — dump vrais marketIds hockey pour un match
import { mget } from '../src/bookmakers/premierbet/api.js';

console.log('▶ PROBE PremierBet HOCKEY RAW\n');
try {
  // Fetch highlights hockey (sportId=4)
  const h = await mget('/events/highlights', { sportId: '4' }, 15000);
  const cats = h?.data?.categories || [];
  let sampleId = null;
  let sampleTeams = '';
  for (const c of cats) {
    for (const cp of (c.competitions || [])) {
      for (const ev of (cp.events || [])) {
        if (ev.id && (ev.eventNames?.length || 0) >= 2) {
          sampleId = ev.id;
          sampleTeams = ev.eventNames.join(' vs ') + ` [${cp.name || c.name}]`;
          break;
        }
      }
      if (sampleId) break;
    }
    if (sampleId) break;
  }
  if (!sampleId) { console.log('  Aucun match hockey highlights'); return; }
  console.log(`  Sample : ${sampleTeams}  id=${sampleId}`);
  const evtJ = await mget(`/events/${sampleId}`, {}, 15000);
  const event = evtJ?.data || evtJ;
  const groups = event?.marketGroups || [];
  let totalMk = 0;
  const stats = {};
  for (const g of groups) {
    for (const mk of (g.markets || [])) {
      totalMk++;
      const id = String(mk.id);
      if (!stats[id]) stats[id] = { name: mk.name, groups: new Set(), outsSamples: [] };
      stats[id].groups.add(g.name || '?');
      if (stats[id].outsSamples.length < 2) {
        const outs = (mk.outcomes || []).slice(0, 6).map(o => `"${o.name}"h=${o.handicap ?? ''}=${o.value}`);
        stats[id].outsSamples.push(outs);
      }
    }
  }
  console.log(`  ${totalMk} markets dans ${groups.length} groups\n`);
  console.log(`  ═══ MarketIds hockey PB (${Object.keys(stats).length}) ═══`);
  for (const [id, s] of Object.entries(stats).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`  marketId=${id}  "${s.name}"  groups=[${[...s.groups].join(',')}]`);
    for (const outs of s.outsSamples) console.log(`     ${outs.join(' | ')}`);
  }
} catch (e) { console.log('ERR:', e.message); }
console.log('\n═══ FIN ═══');
process.exit(0);
