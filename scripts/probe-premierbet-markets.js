#!/usr/bin/env node
// Probe premierbet : pourquoi 3 marches/match seulement ?
// On dump la reponse brute d'un event et on compte les marches disponibles

import { pbGet } from '../src/bookmakers/premierbet/api.js';
import { listMatches } from '../src/bookmakers/premierbet/list.js';
import { extractMarkets } from '../src/bookmakers/premierbet/api.js';
import { premierbetFlatOdds } from '../src/bookmakers/premierbet/parse.js';

console.log('=== 1 : recup liste matchs foot ===');
const matches = await listMatches({ live: false, horizonHours: 72 });
console.log(`  ${matches.length} matchs foot`);
console.log(`  sample: ${matches.slice(0, 3).map(m => `${m.home} vs ${m.away}`).join(' | ')}`);

const m = matches[0];
if (!m) { console.log('  aucun match'); process.exit(0); }

console.log(`\n=== 2 : GET /events/${m.id} sur "${m.home} vs ${m.away}" ===`);
const data = await pbGet(`/events/${m.id}`, {}, { long: false });
const event = data?.data || data || null;
console.log(`  event top-keys: ${Object.keys(event || {}).join(',')}`);
console.log(`  event.markets: ${Array.isArray(event?.markets) ? 'Array('+event.markets.length+')' : typeof event?.markets}`);
console.log(`  event.marketGroups: ${Array.isArray(event?.marketGroups) ? 'Array('+event.marketGroups.length+')' : typeof event?.marketGroups}`);

if (Array.isArray(event?.marketGroups)) {
  console.log('\n  === marketGroups details ===');
  for (const g of event.marketGroups) {
    console.log(`    group "${g.name}" id=${g.id}: ${(g.markets || []).length} markets`);
  }
}

if (Array.isArray(event?.markets)) {
  console.log('\n  === markets details (top level) ===');
  for (const mk of event.markets.slice(0, 15)) {
    console.log(`    m.id=${mk.id} "${mk.name}" outcomes=${(mk.outcomes || []).length}`);
  }
}

const extracted = extractMarkets(event);
console.log(`\n  ${extracted.length} marches extraits (dedoublonnes)`);
console.log(`  20 premiers noms : ${extracted.slice(0, 20).map(m => m.name).join(' | ')}`);

const flat = premierbetFlatOdds(extracted);
console.log(`  ${Object.keys(flat).length} cotes plates`);
console.log(`  cles : ${Object.keys(flat).join(', ')}`);

console.log('\n=== 3 : test avec long=true (parfois plus de marches) ===');
const long = await pbGet(`/events/${m.id}`, {}, { long: true });
const longEvent = long?.data || long;
const longMk = extractMarkets(longEvent);
console.log(`  long=true : ${longMk.length} marches`);

console.log('\n=== 4 : essai endpoint alternatif /events/{id}/markets ===');
const altMk = await pbGet(`/events/${m.id}/markets`, {}, { long: false });
if (altMk) {
  console.log(`  /events/${m.id}/markets: keys=${Object.keys(altMk?.data || altMk).slice(0,5).join(',')}`);
} else console.log('  null');

console.log('\n=== FIN ===');
