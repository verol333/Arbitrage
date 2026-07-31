// Audit PremierBet mobile API : structure des marchés, noms, outcomes.
import { mget, splitTeams, isVirtual } from '../src/bookmakers/premierbet/api.js';
import { premierbetFlatOdds } from '../src/bookmakers/premierbet/parse.js';

const SPORT_ID = '1';

async function listEvents() {
  const today = new Date().toISOString().slice(0, 10);
  const [upcoming, highlights] = await Promise.all([
    mget('/events/upcoming', { sportId: SPORT_ID, timeOffset: '-60', date: today }),
    mget('/events/highlights', { sportId: SPORT_ID }),
  ]);

  function extract(result) {
    if (!result?.data) return [];
    const data = result.data;
    if (Array.isArray(data)) return data;
    const out = [];
    for (const cat of (data.categories || [])) {
      for (const comp of (cat.competitions || [])) out.push(...(comp.events || []));
    }
    return out;
  }

  const ids = new Map();
  for (const ev of extract(upcoming)) if (ev.id) ids.set(ev.id, ev);
  for (const ev of extract(highlights)) if (ev.id) ids.set(ev.id, ev);

  console.log(`upcoming=${extract(upcoming).length} highlights=${extract(highlights).length} unique=${ids.size}`);
  return [...ids.values()];
}

function dedupeMarkets(event) {
  const raw = [];
  if (event.markets) raw.push(...event.markets);
  else if (event.marketGroups) {
    for (const g of event.marketGroups) raw.push(...(g.markets || []));
  }
  const seen = new Set();
  return raw.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
}

console.log('=== PREMIERBET MOBILE API AUDIT ===\n');

const events = await listEvents();
const footEvents = events.filter(ev => {
  const teams = splitTeams(ev.eventNames);
  if (!teams) return false;
  if (isVirtual(`${teams.home} ${teams.away}`)) return false;
  return true;
});

console.log(`Total foot events: ${footEvents.length}\n`);

// Pick 3 matches: first, middle, last upcoming
const now = Date.now();
const upcoming = footEvents.filter(e => e.startTime && e.startTime > now).sort((a, b) => a.startTime - b.startTime);
const picks = [];
if (upcoming.length >= 3) {
  picks.push(upcoming[0]);
  picks.push(upcoming[Math.floor(upcoming.length / 2)]);
  picks.push(upcoming[upcoming.length - 1]);
} else picks.push(...upcoming.slice(0, 3));

console.log(`Picks: ${picks.length} matches\n`);

const allMarketNames = new Map();

for (const [i, ev] of picks.entries()) {
  const teams = splitTeams(ev.eventNames);
  const label = teams ? `${teams.home} vs ${teams.away}` : JSON.stringify(ev.eventNames);
  console.log(`\n─── MATCH ${i + 1}/${picks.length} : ${label} [${ev.competitionName || ''}] id=${ev.id} ───`);

  const full = await mget(`/events/${ev.id}`);
  if (!full) { console.log('  FAILED to fetch'); continue; }

  const markets = dedupeMarkets(full);
  console.log(`  State: ${full.state} | Markets: ${markets.length} | Groups: ${full.marketGroups?.length || 0}`);

  // Dump market groups
  if (full.marketGroups) {
    for (const g of full.marketGroups) {
      console.log(`  Group: "${g.name}" (${g.markets?.length || 0} markets)`);
    }
  }

  console.log(`\n  All markets:`);
  for (const m of markets) {
    const outcomes = m.outcomes || [];
    const oStr = outcomes.slice(0, 8).map(o => `${o.name}=${o.value}`).join(' | ');
    const extra = outcomes.length > 8 ? ` ...+${outcomes.length - 8}` : '';
    // Show key fields
    const specials = [];
    if (m.specifier != null) specials.push(`spec="${m.specifier}"`);
    if (m.specialValue != null) specials.push(`sv=${m.specialValue}`);
    if (m.line != null) specials.push(`line=${m.line}`);
    if (m.handicap != null) specials.push(`hcp=${m.handicap}`);
    const specStr = specials.length ? ` [${specials.join(', ')}]` : '';
    console.log(`    "${m.name}" (${outcomes.length} out)${specStr}: ${oStr}${extra}`);

    // Aggregate
    const key = m.name || '??';
    if (!allMarketNames.has(key)) allMarketNames.set(key, { count: 0, sample_outcomes: [], matches: new Set() });
    const agg = allMarketNames.get(key);
    agg.count++;
    agg.matches.add(i);
    if (agg.sample_outcomes.length < 6) {
      for (const o of outcomes.slice(0, 6)) agg.sample_outcomes.push({ name: o.name, value: o.value });
    }
  }

  // Run parser
  const parsed = premierbetFlatOdds(markets);
  const keys = Object.keys(parsed);
  console.log(`\n  Parser output: ${keys.length} odds`);
  console.log(`    ${keys.sort().join(', ')}`);
}

// Global synthesis
console.log('\n\n=== SYNTHESE MARKET NAMES (across all matches) ===');
for (const [name, info] of [...allMarketNames.entries()].sort((a, b) => b.count - a.count)) {
  const oSample = info.sample_outcomes.slice(0, 4).map(o => `${o.name}=${o.value}`).join(' | ');
  console.log(`  "${name}" x${info.count} (${info.matches.size}/3): ${oSample}`);
}
console.log(`\nTotal unique market names: ${allMarketNames.size}`);

process.exit(0);
