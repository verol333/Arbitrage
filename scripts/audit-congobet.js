// Audit Congobet foot : liste 3 matchs, dump tous les eventBetTypes disponibles
// (id, name, ctx.total, items). Objectif : mapper "Écart" terminology + trouver
// betTypeIds non mappés utiles.
import { CONGO_API, congoJson } from '../src/bookmakers/congobet/api.js';
import { listPrematch } from '../src/bookmakers/congobet/list.js';
import { getOdds } from '../src/bookmakers/congobet/odds.js';

console.log('=== CONGOBET FOOTBALL AUDIT ===\n');

const matches = await listPrematch('football');
console.log(`Total football matches: ${matches.length}`);

const now = Date.now();
const upcoming = matches.filter(m => m.start && m.start > now).sort((a,b) => a.start - b.start);
const picks = [upcoming[0], upcoming[Math.floor(upcoming.length / 2)], upcoming[upcoming.length - 1]].filter(Boolean);

const allBetTypes = new Map(); // betTypeId → { name, count, sample_items }

for (const [i, m] of picks.entries()) {
  console.log(`\n─── MATCH ${i+1}/${picks.length} : ${m.home} vs ${m.away} [${m.league}] ${new Date(m.start).toISOString()} ───`);
  const raw = await congoJson(`${CONGO_API}events/${m.id}`);
  if (!raw?.eventBetTypes) { console.log('  NO eventBetTypes'); continue; }
  console.log(`  eventBetTypes: ${raw.eventBetTypes.length}`);

  for (const bt of raw.eventBetTypes) {
    const rawId = Number(bt.betTypeId);
    const id = rawId >= 20000 && rawId < 30000 ? rawId - 10000 : rawId;
    const items = (bt.eventBetTypeItems || []).filter(it => it.active && it.bettingAllowed && Number(it.odds) > 1);
    if (!items.length) continue;
    let ctx = null;
    try { ctx = JSON.parse(bt.betTypeContext || '{}'); } catch { /* ignore */ }
    const ctxStr = ctx && Object.keys(ctx).length ? ` ctx=${JSON.stringify(ctx)}` : '';
    const itemStr = items.slice(0, 6).map(it => `${it.shortName}@${it.odds}`).join(' | ');
    console.log(`    id=${id}${rawId !== id ? `(live=${rawId})` : ''} "${bt.name}"${ctxStr} ${items.length}i: ${itemStr}${items.length > 6 ? ` ...+${items.length - 6}` : ''}`);
    if (!allBetTypes.has(id)) allBetTypes.set(id, { name: bt.name, count: 0, sample: [] });
    const agg = allBetTypes.get(id);
    agg.count++;
    if (agg.sample.length < 4) {
      for (const it of items.slice(0, 4)) agg.sample.push({ shortName: it.shortName, odds: it.odds });
    }
  }

  const parsed = await getOdds(m.id);
  const keys = parsed ? Object.keys(parsed) : [];
  console.log(`\n  Parseur: ${keys.length} cotes`);
  console.log(`    ${keys.sort().join(', ')}`);
}

// Synthese
const currentDict = new Set([10001, 10008, 10010, 10003, 10055, 10056, 10015, 10016, 10031, 10007, 10104, 10028, 10011, 10108, 10109, 10107, 10113, 10024, 10120, 10029, 10030, 10124, 10125, 10123, 10127, 10147, 10504, 10153, 10146, 10106, 10119, 10036, 10039]);

console.log('\n\n=== SYNTHESE betTypeIds ===');
const notMapped = [];
for (const [id, info] of [...allBetTypes.entries()].sort((a,b) => a[0] - b[0])) {
  const status = currentDict.has(id) ? '✅ dict' : '❌ MANQUANT';
  const sampleStr = info.sample.slice(0, 3).map(s => `${s.shortName}@${s.odds}`).join(' | ');
  console.log(`  id=${id} ${status} "${info.name}" (${info.count}m): ${sampleStr}`);
  if (!currentDict.has(id)) notMapped.push({ id, name: info.name, sample: info.sample });
}

console.log(`\n📊 ${allBetTypes.size} betTypes vus | ${notMapped.length} non mappés`);
process.exit(0);
