#!/usr/bin/env node
// Probe premierbet v3 : verifier fix parseur + dump outcome baseValues
import { pbGet, extractMarkets, extractLine } from '../src/bookmakers/premierbet/api.js';
import { listMatches } from '../src/bookmakers/premierbet/list.js';
import { premierbetFlatOdds } from '../src/bookmakers/premierbet/parse.js';

const matches = await listMatches({ live: false, horizonHours: 72 });
const m = matches[0];
console.log(`Match: ${m.home} vs ${m.away}\n`);

const data = await pbGet(`/events/${m.id}`, {}, { long: false });
const event = data?.data || data || null;
const markets = extractMarkets(event);

// Dump outcome baseValues pour "Nombre total de buts"
const totalMk = markets.find(mk => /nombre total de buts/i.test(mk.name || ''));
if (totalMk) {
  console.log(`"${totalMk.name}" — outcome-level dump :`);
  console.log(`  market keys: ${Object.keys(totalMk).join(',')}`);
  for (const o of totalMk.outcomes) {
    console.log(`  outcome keys=${Object.keys(o).join(',')} extractLine=${extractLine(totalMk, o)} data=${JSON.stringify(o)}`);
    break;
  }
  for (const o of totalMk.outcomes.slice(0, 6)) {
    console.log(`  ${o.name} val=${o.value ?? o.odds} line=${extractLine(totalMk, o)}`);
  }
}

const hcpMk = markets.find(mk => /1x2.*handicap/i.test(mk.name || ''));
if (hcpMk) {
  console.log(`\n"${hcpMk.name}" — outcome-level dump :`);
  for (const o of hcpMk.outcomes.slice(0, 4)) {
    console.log(`  ${o.name} val=${o.value ?? o.odds} line=${extractLine(hcpMk, o)} keys=${Object.keys(o).join(',')}`);
  }
}

const ttMk = markets.find(mk => /total.*equipe.*dom/i.test(mk.name || ''));
if (ttMk) {
  console.log(`\n"${ttMk.name}" — outcome-level dump :`);
  for (const o of ttMk.outcomes.slice(0, 4)) {
    console.log(`  ${o.name} val=${o.value ?? o.odds} line=${extractLine(ttMk, o)}`);
  }
}

const flat = premierbetFlatOdds(markets);
console.log(`\n=== ${Object.keys(flat).length} cotes plates ===`);
const groups = { match: [], hcp: [], tt: [], over: [], under: [], ht: [], h2: [], other: [] };
for (const k of Object.keys(flat).sort()) {
  if (k.startsWith('ht_')) groups.ht.push(k);
  else if (k.startsWith('h2_')) groups.h2.push(k);
  else if (k.startsWith('hcp_')) groups.hcp.push(k);
  else if (k.startsWith('tt_')) groups.tt.push(k);
  else if (k.includes('over')) groups.over.push(k);
  else if (k.includes('under')) groups.under.push(k);
  else if (k.startsWith('match_')) groups.match.push(k);
  else groups.other.push(k);
}
for (const [g, keys] of Object.entries(groups)) {
  if (keys.length) console.log(`  ${g}: ${keys.length} — ${keys.join(', ')}`);
}
