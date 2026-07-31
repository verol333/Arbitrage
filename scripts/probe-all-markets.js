#!/usr/bin/env node
// Diagnostic probe: dumps raw market structures from REST-based bookmakers.
// Run locally: node scripts/probe-all-markets.js [book1,book2,...]
// Default: all REST books. Helps verify odds key mappings against real data.
import { CONGO_API, congoJson } from '../src/bookmakers/congobet/api.js';
import { getOdds as congoGetOdds } from '../src/bookmakers/congobet/odds.js';
import { pbGet, extractEvents, splitTeams, leagueOf } from '../src/bookmakers/premierbet/api.js';
import { premierbetFlatOdds } from '../src/bookmakers/premierbet/parse.js';
import { xget, splitTeams as scSplit } from '../src/bookmakers/sportcash/api.js';
import { sportcashFlatOdds } from '../src/bookmakers/sportcash/parse.js';
import { bpGet } from '../src/bookmakers/betpawa/api.js';

const requestedBooks = (process.argv[2] || 'congobet,premierbet,sportcash,betpawa').split(',');

async function probeCongobet() {
  console.log('\n' + '═'.repeat(60));
  console.log('  CONGOBET — raw market dump');
  console.log('═'.repeat(60));
  try {
    const j = await congoJson(`${CONGO_API}events/highlights?sportId=101&take=5`);
    const evs = j?.events || j || [];
    console.log(`  ${evs.length} events returned`);
    for (const ev of (Array.isArray(evs) ? evs : []).slice(0, 2)) {
      console.log(`\n  ── ${ev.homeTeamName} vs ${ev.awayTeamName} (id=${ev.id}) ──`);
      const detail = await congoJson(`${CONGO_API}events/${ev.id}`);
      if (!detail?.eventBetTypes) { console.log('     No bet types'); continue; }
      console.log(`     ${detail.eventBetTypes.length} bet types`);
      for (const bt of detail.eventBetTypes.slice(0, 25)) {
        const items = (bt.eventBetTypeItems || []).filter(it => it.active && Number(it.odds) > 1);
        let ctx = {};
        try { ctx = JSON.parse(bt.betTypeContext || '{}'); } catch {}
        const sample = items.slice(0, 4).map(it => `"${it.shortName}"=${it.odds}`).join(' | ');
        console.log(`     id=${bt.betTypeId} name="${bt.name || ''}" ctx=${JSON.stringify(ctx)} → ${sample}`);
      }
      const parsed = await congoGetOdds(ev.id);
      const keys = Object.keys(parsed || {}).sort();
      console.log(`     ── Parsed (${keys.length} keys) ──`);
      for (const k of keys) console.log(`       ${k} = ${parsed[k]}`);
    }
  } catch (e) { console.log(`  ERROR: ${e.message}`); }
}

async function probePremierbet() {
  console.log('\n' + '═'.repeat(60));
  console.log('  PREMIERBET — raw market dump');
  console.log('═'.repeat(60));
  try {
    const today = new Date().toISOString().slice(0, 10);
    const page = await pbGet(`events/upcoming?date=${today}&sportId=1&zoomSportId=61&page=0&pageSize=10`);
    const events = extractEvents(page);
    console.log(`  ${events.length} events returned`);
    for (const ev of events.slice(0, 2)) {
      const teams = splitTeams(ev);
      if (!teams) continue;
      console.log(`\n  ── ${teams.home} vs ${teams.away} (id=${ev.id || ev.eventId}) ──`);
      console.log(`     League: ${leagueOf(ev)}`);
      const detail = await pbGet(`events/${ev.id || ev.eventId}`);
      const mkts = detail?.markets || detail?.eventMarkets || [];
      console.log(`     ${mkts.length} markets`);
      for (const m of mkts.slice(0, 25)) {
        const outs = m.outcomes || [];
        const sample = outs.filter(o => Number(o.value || o.odds) > 1).slice(0, 4)
          .map(o => `"${o.name || o.title}"=${o.value || o.odds}${o.baseValue != null ? ` b=${o.baseValue}` : ''}`).join(' | ');
        console.log(`     name="${m.name || m.title}" → ${sample}`);
      }
      const parsed = premierbetFlatOdds(mkts);
      const keys = Object.keys(parsed).sort();
      console.log(`     ── Parsed (${keys.length} keys) ──`);
      for (const k of keys) console.log(`       ${k} = ${parsed[k]}`);
    }
  } catch (e) { console.log(`  ERROR: ${e.message}`); }
}

async function probeSportcash() {
  console.log('\n' + '═'.repeat(60));
  console.log('  SPORTCASH — raw market dump');
  console.log('═'.repeat(60));
  try {
    const hl = await xget('getHomeLandingData', { timezone: '1' });
    const evs = (hl?.bws || []).flatMap(w => w.evs || []);
    console.log(`  ${evs.length} events from landing`);
    for (const ev of evs.filter(e => e.da && e.da.includes(' - ')).slice(0, 2)) {
      const teams = scSplit(ev.da);
      console.log(`\n  ── ${teams?.home} vs ${teams?.away} (ce=${ev.ce}, cd=${ev.cd}) ──`);
      const detail = await xget('getEvento', { ce: ev.ce, cd: ev.cd, timezone: '1' });
      const mkts = detail?.evs?.[0]?.mks || [];
      console.log(`     ${mkts.length} markets`);
      for (const m of mkts.slice(0, 25)) {
        const outs = m.es || [];
        const sample = outs.slice(0, 4).map(e =>
          `ce=${e.ce} "${e.de || ''}"=${Number(e.q) / 100}${m.h != null ? ` h=${Number(m.h) / 100}` : ''}`
        ).join(' | ');
        console.log(`     cs=${m.cs} name="${m.ds || ''}" → ${sample}`);
      }
      const parsed = sportcashFlatOdds(mkts);
      const keys = Object.keys(parsed).sort();
      console.log(`     ── Parsed (${keys.length} keys) ──`);
      for (const k of keys) console.log(`       ${k} = ${parsed[k]}`);
    }
  } catch (e) { console.log(`  ERROR: ${e.message}`); }
}

async function probeBetpawa() {
  console.log('\n' + '═'.repeat(60));
  console.log('  BETPAWA — raw market dump');
  console.log('═'.repeat(60));
  try {
    const list = await bpGet('list?sport=football&country=cg&limit=5');
    const matches = list?.matches || list || [];
    console.log(`  ${matches.length} matches returned`);
    for (const m of (Array.isArray(matches) ? matches : []).slice(0, 2)) {
      console.log(`\n  ── ${m.home} vs ${m.away} (id=${m.id}) ──`);
      console.log(`     League: ${m.league || ''}`);
      const detail = await bpGet(`odds?id=${m.id}&country=cg`);
      const mkts = detail?.markets || detail || {};
      console.log(`     Markets: ${JSON.stringify(Object.keys(mkts))}`);
      for (const [key, val] of Object.entries(mkts)) {
        if (!val || typeof val !== 'object') continue;
        const entries = Array.isArray(val) ? val : Object.entries(val);
        const sample = (Array.isArray(val) ? val : Object.entries(val).map(([k, v]) => `${k}=${v}`))
          .slice(0, 4).join(' | ');
        console.log(`     "${key}" → ${sample}`);
      }
    }
  } catch (e) { console.log(`  ERROR: ${e.message}`); }
}

const runners = {
  congobet: probeCongobet,
  premierbet: probePremierbet,
  sportcash: probeSportcash,
  betpawa: probeBetpawa,
};

for (const book of requestedBooks) {
  const fn = runners[book.trim()];
  if (fn) await fn();
  else console.log(`Unknown book: ${book}`);
}
console.log('\nDone.');
