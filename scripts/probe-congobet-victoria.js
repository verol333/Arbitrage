#!/usr/bin/env node
// Diagnostic : le user rapporte que congobet event id=78071317 (matche avec
// "Victoria vs Unirea" 1xbet/betmomo/1win/yellowbet) donne X2=1.47 alors que
// la cote reelle sur le site n'existe pas. Suspicion : congobet a un AUTRE
// match "Victoria vs Unirea" (noms generiques en Roumanie) et le matcher a
// mis les 2 en correspondance a tort.

import { CONGO_API, congoJson } from '../src/bookmakers/congobet/api.js';

const TARGET_ID = 78071317;

console.log(`\n═══ Congobet event id=${TARGET_ID} — inspection ═══`);
const full = await congoJson(`${CONGO_API}events/${TARGET_ID}`);
if (!full) {
  console.log('  event introuvable');
  process.exit(0);
}
console.log(`  home: "${full.homeTeamName}"`);
console.log(`  away: "${full.awayTeamName}"`);
console.log(`  league: "${full.categoryPath || (full.categories || []).join('/')}"`);
console.log(`  expectedStart: ${full.expectedStart}`);
console.log(`  sportId path: ${(full.categoryPath || '').split('/').filter(Boolean)[0]}`);
console.log(`  bettypes: ${(full.eventBetTypes || []).length}`);
// Chercher DC (10008) et 1X2 (10001)
for (const bt of (full.eventBetTypes || [])) {
  const id = Number(bt.betTypeId);
  if (id !== 10001 && id !== 10008) continue;
  const items = (bt.eventBetTypeItems || []).filter((it) => it.active && it.bettingAllowed);
  const sample = items.map((it) => `${it.shortName}=${it.odds}`).join(' | ');
  console.log(`  bettype ${id} "${bt.name}" : ${sample}`);
}

// Explorer tous les events football contenant "Victoria" ou "Unirea"
console.log(`\n═══ Tous events football avec "Victoria" ou "Unirea" ═══`);
const seen = new Map();
// Approche : lister toutes les leaf categories foot, chercher events matchant
const cats = await congoJson(`${CONGO_API}eventCategories/101?l=fr`);
const leaves = [];
const collect = (n) => {
  const subs = n.subCategories || [];
  if (!subs.length && (n.eventsCount || 0) > 0) leaves.push(n);
  else subs.forEach(collect);
};
(Array.isArray(cats) ? cats : []).forEach(collect);
console.log(`  foot leaves: ${leaves.length}`);
// Filtre Romanian Cup si dispo
const roLeaves = leaves.filter((l) => /roumanie|romania/i.test(l.name || '') || /roumanie|romania/i.test(l.parentName || ''));
console.log(`  leaves roumains: ${roLeaves.length}`);
for (const lf of roLeaves.slice(0, 10)) console.log(`    ${lf.id} "${lf.name}"`);

// Chercher dans TOUS les leaves foot
let hits = 0;
const targetTokens = /victoria|unirea|traian|branistea|branistea/i;
const BATCH = 8;
for (let i = 0; i < leaves.length && hits < 100; i += BATCH) {
  const batch = leaves.slice(i, i + BATCH);
  const results = await Promise.all(batch.map((lf) =>
    congoJson(`${CONGO_API}events?eventCategoryIds=${lf.id}&offset=0&length=50&fetchEventBetTypesMode=0&betTypeId=10001&l=fr`)
  ));
  for (let k = 0; k < batch.length; k++) {
    const r = results[k];
    const items = Array.isArray(r) ? r : (r?.data || []);
    for (const ev of items) {
      const nam = `${ev.homeTeamName || ''} ${ev.awayTeamName || ''}`;
      if (!targetTokens.test(nam)) continue;
      const key = ev.id;
      if (seen.has(key)) continue;
      seen.set(key, true);
      console.log(`  ★ id=${ev.id} "${ev.homeTeamName}" vs "${ev.awayTeamName}" | ${ev.categoryPath} | start=${ev.expectedStart}`);
      hits++;
    }
  }
}
console.log(`\n  total hits: ${hits}`);

process.exit(0);
