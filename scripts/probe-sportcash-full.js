#!/usr/bin/env node
// Probe sportcash v2 : explorer getSportList + hierarchy Sport→Manif→Ev

import { fetchJson } from '../src/net/fetcher.js';

const BASE = 'https://sportcash.ci/XSportDatastore';
const HDR = { 'user-agent': 'Mozilla/5.0', accept: 'application/json, text/plain, */*', referer: 'https://sportcash.ci/' };
const COMMON = { systemCode: 'SPORTCASH', lingua: 'FR', hash: '' };

async function xget(endpoint, params = {}) {
  const qs = new URLSearchParams({ ...COMMON, ...params }).toString();
  const t0 = Date.now();
  const j = await fetchJson(`${BASE}/${endpoint}?${qs}`, { headers: HDR, timeoutMs: 15000 });
  return { j, ms: Date.now() - t0 };
}

console.log('=== 1 : getSportList (162 items) — inspecter structure ===');
const sl = await xget('getSportList');
if (sl.j && Array.isArray(sl.j)) {
  console.log(`  Array of ${sl.j.length}`);
  console.log(`  sample[0]: ${JSON.stringify(sl.j[0])}`);
  console.log(`  sample[1]: ${JSON.stringify(sl.j[1])}`);
  // Chercher item avec label football
  const foot = sl.j.find(x => /foot|calcio|soccer/i.test(JSON.stringify(x)));
  if (foot) console.log(`  foot item: ${JSON.stringify(foot)}`);
} else if (sl.j) {
  console.log(`  keys=${Object.keys(sl.j).join(',')}`);
  console.log(`  first values: ${JSON.stringify(sl.j).slice(0, 400)}`);
}

console.log('\n=== 2 : endpoints hierarchy — Manifestazioni ===');
const manifEndpoints = [
  'getManifestazioneList',
  'getManifestazioni',
  'getListaManifestazioniSport',
  'getManifestazioniBySport',
  'getMenu',
  'getMenuSport',
  'getSportMenu',
  'getSportCategories',
  'getSottoManif',
  'getBambini',
];
for (const ep of manifEndpoints) {
  for (const params of [{}, { sport: '1' }, { p: '1' }, { pal: '1' }, { idSport: '1' }, { spid: '1' }]) {
    const { j, ms } = await xget(ep, params);
    if (j) {
      const size = JSON.stringify(j).length;
      const type = Array.isArray(j) ? `Array(${j.length})` : `Obj(keys=${Object.keys(j).slice(0, 5).join(',')})`;
      console.log(`  ✓ ${ep}?${new URLSearchParams(params).toString()} → ${ms}ms ${type} size=${size}`);
      if (Array.isArray(j) && j.length > 0) console.log(`    sample: ${JSON.stringify(j[0]).slice(0, 200)}`);
      break;
    }
  }
}

console.log('\n=== 3 : endpoints hierarchy — Avvenimenti (events) ===');
const evEndpoints = [
  'getAvvenimentiSport',
  'getAvvenimentiManifestazione',
  'getListaAvvenimenti',
  'getListaAvvenimentiSport',
  'getAvvenimentiByManif',
  'getEvents',
  'getEventsBySport',
  'getAllAvvenimenti',
  'getElencoAvvenimenti',
  'getEventiByManif',
  'getEventiSport',
];
for (const ep of evEndpoints) {
  for (const params of [
    { sport: '1' }, { pal: '1' }, { idSport: '1' },
    { spid: '1' }, { idManifestazione: '1' }, { manif: '1' },
    { p: '1', a: '' }, { sport: '1', manif: '1' },
  ]) {
    const { j, ms } = await xget(ep, params);
    if (j) {
      const size = JSON.stringify(j).length;
      const type = Array.isArray(j) ? `Array(${j.length})` : `Obj(keys=${Object.keys(j).slice(0, 5).join(',')})`;
      console.log(`  ✓ ${ep}?${new URLSearchParams(params).toString()} → ${ms}ms ${type} size=${size}`);
      if (Array.isArray(j) && j.length > 0) console.log(`    sample[0]: ${JSON.stringify(j[0]).slice(0, 250)}`);
      break;
    }
  }
}

console.log('\n=== 4 : essai patterns sportcash-specifiques ===');
const misc = [
  'getPalinsestoManifestazione',
  'getPalinsestoAvvenimenti',
  'getRicercaAvvenimenti',
  'getRicerca',
  'searchEvents',
  'ricerca',
  'getTuttiAvvenimenti',
  'getAvvsBySport',
  'getPalinsestoSport',
];
for (const ep of misc) {
  const { j, ms } = await xget(ep, { sport: '1' });
  if (j) {
    const size = JSON.stringify(j).length;
    console.log(`  ✓ ${ep}?sport=1 → ${ms}ms size=${size}`);
    if (typeof j === 'object' && !Array.isArray(j)) {
      for (const [k, v] of Object.entries(j)) {
        if (Array.isArray(v)) console.log(`    ${k}: Array(${v.length})`);
        else if (typeof v === 'object') console.log(`    ${k}: keys=${Object.keys(v).slice(0, 3).join(',')}`);
      }
    }
  }
}

console.log('\n=== 5 : capture www.sportcash.ci HTML pour trouver endpoints XHR ===');
const html = await fetchJson('https://sportcash.ci/scommesse/calcio', { headers: HDR, timeoutMs: 15000 });
if (html) console.log(`  HTML returned (${JSON.stringify(html).length} bytes)`);
else console.log('  HTML non-JSON, tentative fetch text');

const res = await fetch('https://sportcash.ci/scommesse/calcio', { headers: HDR });
const text = await res.text();
console.log(`  scommesse/calcio status=${res.status} len=${text.length}`);
// Chercher URLs XSportDatastore dans le HTML
const xhrPaths = [...text.matchAll(/XSportDatastore\/(\w+)/g)].map(m => m[1]);
const unique = [...new Set(xhrPaths)].sort();
console.log(`  endpoints trouves : ${unique.length}`);
unique.forEach(e => console.log(`    ${e}`));

console.log('\n=== FIN ===');
