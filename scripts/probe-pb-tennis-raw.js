#!/usr/bin/env node
// Dump BRUT ce que PB retourne pour sportId=2 (tennis)
// Verifier si sportId a change ou si les evenements Belize U20 sont bien tennis
import { mget } from '../src/bookmakers/premierbet/api.js';

console.log('▶▶▶ Probe PB : que retourne sportId=2 (tennis) ?');

for (const [label, path, extra] of [
  ['upcoming today', '/events/upcoming', { sportId: '2', timeOffset: '-60', date: new Date().toISOString().slice(0, 10) }],
  ['upcoming +1', '/events/upcoming', { sportId: '2', timeOffset: '-60', date: new Date(Date.now() + 86400000).toISOString().slice(0, 10) }],
  ['highlights', '/events/highlights', { sportId: '2' }],
]) {
  console.log(`\n═══ ${label} ═══`);
  try {
    const r = await mget(path, extra);
    // Structure : r.data.categories[].competitions[].events[]
    const cats = r?.data?.categories || [];
    console.log(`  ${cats.length} categories`);
    for (const cat of cats.slice(0, 5)) {
      console.log(`  ► "${cat.name}" (id=${cat.id})`);
      for (const comp of (cat.competitions || []).slice(0, 3)) {
        console.log(`      "${comp.name}" (${comp.events?.length || 0} events)`);
        for (const ev of (comp.events || []).slice(0, 3)) {
          console.log(`        ${JSON.stringify(ev.eventNames)} start=${ev.startTime ? new Date(ev.startTime).toISOString() : '?'}`);
        }
      }
    }
  } catch (e) { console.log(`  ERR ${e.message}`); }
}

// Aussi tester sportId=1, 3, 4, 5 pour identifier
console.log(`\n═══ Test differentes sportId ═══`);
for (const sid of ['1', '2', '3', '4', '5', '6', '7', '10', '12', '20']) {
  try {
    const r = await mget('/events/upcoming', { sportId: sid, timeOffset: '-60', date: new Date().toISOString().slice(0, 10) });
    const cats = r?.data?.categories || [];
    const nEvents = cats.reduce((a, c) => a + (c.competitions || []).reduce((b, comp) => b + (comp.events?.length || 0), 0), 0);
    const catNames = cats.slice(0, 3).map(c => c.name).join(', ');
    const sample = (cats[0]?.competitions?.[0]?.events?.[0]?.eventNames || []).join(' vs ');
    console.log(`  sportId=${sid.padStart(3)}: ${nEvents} events, ${cats.length} cats. ex cats: [${catNames}]. sample: "${sample}"`);
  } catch (e) { console.log(`  sportId=${sid}: ERR ${e.message}`); }
}

console.log('\n═══ FIN ═══');
