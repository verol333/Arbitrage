// Dump structure markets du 1er event featured pour comprendre les noms outcomes
import { fetchFeaturedFootball } from '../src/bookmakers/premierbet/api.js';
import { premierbetFlatOdds } from '../src/bookmakers/premierbet/parse.js';
const events = await fetchFeaturedFootball();
console.log(`Got ${events.length} events`);
if (events.length) {
  const e = events[0];
  console.log('Event:', e.eventNames?.join(' vs '));
  console.log('Markets count:', e.markets?.length);
  for (const m of (e.markets || [])) {
    const outs = (m.outcomes || []).map((o) => `"${o.name}"=${o.value}`).join(' | ');
    console.log(`  id=${m.id} name="${m.name}" outcomes=${m.outcomes?.length}  [${outs.slice(0, 200)}]`);
  }
  const parsed = premierbetFlatOdds(e.markets || []);
  console.log('PARSED KEYS:', Object.keys(parsed));
  console.log('PARSED:', parsed);
}
process.exit(0);
