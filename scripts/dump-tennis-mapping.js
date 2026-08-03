#!/usr/bin/env node
// Dump complet des markets tennis (1-2 matchs par book) pour mapping manuel.
// Cible : les 7 books qui n'ont pas retourne de cotes tennis (ou 0 matchs).
//
// Format sortie : Pour chaque book, on affiche
//   - 1-2 matchs (equipes + league + start)
//   - Full raw markets JSON pour ces matchs (market id + name + outcomes)

import { fetchJson } from '../src/net/fetcher.js';

const dumpMatch = (label, m) => {
  console.log(`\n  ┌── ${label}`);
  console.log(`  │ home: ${m.home}`);
  console.log(`  │ away: ${m.away}`);
  console.log(`  │ league: ${m.league || '?'}`);
  console.log(`  │ start: ${m.start ? new Date(m.start).toISOString() : '?'}`);
  console.log(`  │ id: ${m.id}`);
};

const dumpMarkets = (markets, maxShow = 20) => {
  console.log(`  │ ${markets.length} markets bruts:`);
  for (const mk of markets.slice(0, maxShow)) {
    console.log(`  │   ${JSON.stringify(mk).slice(0, 400)}`);
  }
  if (markets.length > maxShow) console.log(`  │   ... (${markets.length - maxShow} de plus)`);
  console.log('  └──');
};

// ═══════════════════════════════════════════════════════════════
// 1) BETPAWA — probe categoryIds pour trouver tennis
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ BETPAWA — probe categoryIds tennis ════════════');
try {
  const { bpFetchList, buildEventsListUrl } = await import('../src/bookmakers/betpawa/api.js');
  for (const catId of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20]) {
    const url = buildEventsListUrl({ categories: [String(catId)], take: 5 });
    const strings = await bpFetchList(url);
    // Extract ID pairs (id + name)
    const pairs = [];
    for (let i = 0; i < strings.length - 1; i++) {
      if (/^\d{7,10}$/.test(strings[i]) && strings[i + 1].includes(' - ')) {
        pairs.push({ id: strings[i], name: strings[i + 1] });
      }
    }
    const uniqPairs = pairs.filter((p, i, arr) => arr.findIndex(q => q.id === p.id) === i).slice(0, 3);
    console.log(`  categoryId=${catId}: ${uniqPairs.length} matchs — ${uniqPairs.map(p => p.name).join(' | ')}`);
  }
  // Prendre category 5 par défaut + 2 matchs
  console.log('\n  --- Fetching 2 matchs category=5 (defaut tennis) ---');
  const url5 = buildEventsListUrl({ categories: ['5'], take: 5 });
  const strs = await bpFetchList(url5);
  const ids = [];
  for (let i = 0; i < strs.length - 1; i++) {
    if (/^\d{7,10}$/.test(strs[i]) && strs[i + 1].includes(' - ')) ids.push({ id: strs[i], name: strs[i + 1] });
  }
  const uniqIds = ids.filter((p, i, arr) => arr.findIndex(q => q.id === p.id) === i).slice(0, 2);
  const { bpFetchEvent } = await import('../src/bookmakers/betpawa/api.js');
  for (const { id, name } of uniqIds) {
    const evt = await bpFetchEvent(id, 15_000, { fresh: true });
    const markets = evt?.markets || [];
    dumpMatch(`BETPAWA cat=5 : ${name}`, { home: name.split(' - ')[0], away: name.split(' - ')[1] || '?', league: '?', start: null, id });
    dumpMarkets(markets);
  }
} catch (e) { console.log(`  ERR ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 2) YELLOWBET — probe pourquoi 403 tennis
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ YELLOWBET — probe 403 tennis ════════════');
try {
  // Try sport 35 (tennis) direct fetch to see error
  const { fetchStealth } = await import('../src/net/fetcher.js');
  for (const sid of [35, 36, 37, 40, 47]) {
    const url = `https://yellowbet.cg/services/evapi/event/GetEvents?skip=0&take=5&sportId=${sid}&categoryTypeIds=all&langId=en`;
    try {
      const j = await fetchStealth(url, { timeoutMs: 12000 });
      const events = j?.value?.events || j?.events || [];
      console.log(`  sportId=${sid}: ${events.length} events`);
      if (events.length > 0) {
        console.log(`    sample: ${events[0]?.homeTeam?.name || '?'} vs ${events[0]?.awayTeam?.name || '?'}`);
      }
    } catch (e) { console.log(`  sportId=${sid}: ERR ${e.message}`); }
  }
} catch (e) { console.log(`  ERR ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 3) 1WIN — dump groups tennis d'un match
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ 1WIN — dump groups tennis (2 matchs) ════════════');
try {
  const { listPrematch } = await import('../src/bookmakers/onewin/list.js');
  const { fetchOddsWS } = await import('../src/bookmakers/onewin/ws.js');
  const matches = await listPrematch('tennis');
  console.log(`  ${matches.length} matchs listes`);
  const sample = matches.slice(0, 2);
  if (sample.length) {
    const rawMap = await fetchOddsWS(sample.map(m => m.id));
    for (const m of sample) {
      const groups = rawMap.get(m.id) || rawMap.get(String(m.id));
      dumpMatch(`1WIN : ${m.home} vs ${m.away}`, m);
      if (!groups) { console.log(`  │ (aucune cote WS)`); console.log('  └──'); continue; }
      console.log(`  │ ${Object.keys(groups).length} groupes:`);
      for (const [gname, glist] of Object.entries(groups)) {
        const outcomes = (glist || []).slice(0, 4).map(o => `${o.name || o.outcome || '?'}(${o.cf})`).join(', ');
        console.log(`  │   "${gname}" (${(glist || []).length} outcomes) → ${outcomes}${glist.length > 4 ? '...' : ''}`);
      }
      console.log('  └──');
    }
  }
} catch (e) { console.log(`  ERR ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 4) APOLLO — dump BetTypeKeys tennis
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ APOLLO — dump BetTypeKeys tennis (2 matchs) ════════════');
try {
  const { listMatches, fetchOffers } = await import('../src/bookmakers/apollo/list.js');
  const matches = await listMatches({ live: false, sport: 'tennis' });
  console.log(`  ${matches.length} matchs listes`);
  const sample = matches.slice(0, 2);
  if (sample.length) {
    const map = await fetchOffers(sample.map(m => m.id));
    for (const m of sample) {
      const offers = map.get(m.id) || [];
      dumpMatch(`APOLLO : ${m.home} vs ${m.away}`, m);
      console.log(`  │ ${offers.length} offers`);
      // Group by BetTypeKey
      const byKey = {};
      for (const o of offers) {
        const key = o.BetTypeKey ?? o.betTypeKey ?? o.MarketId ?? '?';
        const name = o.BetTypeName ?? o.betTypeName ?? o.MarketName ?? '?';
        if (!byKey[key]) byKey[key] = { name, samples: [] };
        for (const oc of (o.Odds || o.odds || [])) {
          byKey[key].samples.push(`${oc.OutcomeName || oc.outcomeName || '?'}=${oc.Value ?? oc.value}`);
        }
      }
      for (const [k, v] of Object.entries(byKey)) {
        console.log(`  │   BetTypeKey=${k} "${v.name}" → ${v.samples.slice(0, 4).join(', ')}`);
      }
      console.log('  └──');
    }
  }
} catch (e) { console.log(`  ERR ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 5) BETMOMO — dump market types tennis
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ BETMOMO — dump market types tennis (2 matchs) ════════════');
try {
  const { listMatches } = await import('../src/bookmakers/betmomo/list.js');
  const matches = await listMatches({ live: false, horizonHours: 72, sport: 'tennis' });
  console.log(`  ${matches.length} matchs listes`);
  const sample = matches.slice(0, 2);
  for (const m of sample) {
    const markets = m.__raw?.markets || [];
    dumpMatch(`BETMOMO : ${m.home} vs ${m.away}`, m);
    console.log(`  │ ${markets.length} markets`);
    // Group by market type
    const byType = {};
    for (const mk of markets) {
      const type = mk.type || mk.marketType || mk.Type || '?';
      const name = mk.name || mk.MarketName || '?';
      if (!byType[type]) byType[type] = { name, count: 0, samples: [] };
      byType[type].count++;
      const events = mk.events || mk.selections || mk.outcomes || [];
      for (const e of events.slice(0, 3)) {
        byType[type].samples.push(`${e.type || e.name || '?'}=${e.price ?? e.odds ?? e.value ?? '?'}`);
      }
    }
    for (const [t, v] of Object.entries(byType)) {
      console.log(`  │   type="${t}" (${v.count}x) "${v.name}" → ${v.samples.slice(0, 5).join(', ')}`);
    }
    console.log('  └──');
  }
} catch (e) { console.log(`  ERR ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 6) SPORTYBET — dump market IDs tennis
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ SPORTYBET — dump market IDs tennis (2 matchs) ════════════');
try {
  const { listPrematch } = await import('../src/bookmakers/sportybet/list.js');
  const matches = await listPrematch({ sport: 'tennis' });
  console.log(`  ${matches.length} matchs listes`);
  const sample = matches.slice(0, 2);
  for (const m of sample) {
    const markets = m.__raw?.markets || [];
    dumpMatch(`SPORTYBET : ${m.home} vs ${m.away}`, m);
    console.log(`  │ ${markets.length} markets`);
    for (const mk of markets.slice(0, 20)) {
      const outcomes = (mk.outcomes || []).slice(0, 4).map(o => `${o.desc || o.description || '?'}=${o.odds}`).join(', ');
      console.log(`  │   id=${mk.id} "${mk.desc || mk.description || '?'}" specifier=${mk.specifier || ''} → ${outcomes}`);
    }
    console.log('  └──');
  }
} catch (e) { console.log(`  ERR ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 7) PREMIERBET (via guineegames) — dump markets tennis
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ PREMIERBET (guineegames sportId=2) — dump markets tennis (2 matchs) ════════════');
try {
  const { listMatches } = await import('../src/bookmakers/premierbet/list.js');
  const { getOdds } = await import('../src/bookmakers/premierbet/odds.js');
  const matches = await listMatches({ live: false, horizonHours: 72, sport: 'tennis' });
  console.log(`  ${matches.length} matchs listes`);
  const sample = matches.slice(0, 2);
  for (const m of sample) {
    // Fetch full event JSON via same path as prod
    const { mget } = await import('../src/bookmakers/premierbet/api.js');
    const evt = await mget(`/events/${m.id}`, {});
    const event = evt?.data || evt;
    const marketGroups = event?.marketGroups || [];
    dumpMatch(`PREMIERBET : ${m.home} vs ${m.away}`, m);
    console.log(`  │ ${marketGroups.length} market groups:`);
    for (const g of marketGroups) {
      console.log(`  │   groupe "${g.name}" : ${(g.markets || []).length} markets`);
      for (const mk of (g.markets || []).slice(0, 5)) {
        const outcomes = (mk.outcomes || []).slice(0, 4).map(o => `${o.name}=${o.value}`).join(', ');
        console.log(`  │     id=${mk.id} "${mk.name}" → ${outcomes}`);
      }
    }
    console.log('  └──');
  }
} catch (e) { console.log(`  ERR ${e.message}`); console.error(e.stack); }

console.log('\n═══════════════ FIN DUMP ═══════════════');
