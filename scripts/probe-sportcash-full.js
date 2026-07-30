#!/usr/bin/env node
// Probe sportcash : trouver l'endpoint catalogue foot COMPLET
// (les endpoints actuels getWidgetCentrali+getHomeLandingData ne renvoient
// que les tops → 14 matchs foot au lieu de 300+)

import { fetchJson } from '../src/net/fetcher.js';

const BASE = 'https://sportcash.ci/XSportDatastore';
const HDR = {
  'user-agent': 'Mozilla/5.0',
  accept: 'application/json, text/plain, */*',
  referer: 'https://sportcash.ci/',
};
const COMMON = { systemCode: 'SPORTCASH', lingua: 'FR', hash: '' };

async function xget(endpoint, params = {}) {
  const qs = new URLSearchParams({ ...COMMON, ...params }).toString();
  const t0 = Date.now();
  const url = `${BASE}/${endpoint}?${qs}`;
  const j = await fetchJson(url, { headers: HDR, timeoutMs: 15000 });
  return { j, ms: Date.now() - t0, url };
}

// Endpoints candidats deja explores
const CANDIDATES = [
  'getPalinsesto',
  'getManifestazione',
  'getAvvenimenti',
  'getSport',
  'getSports',
  'getEventiSport',
  'getAllEvents',
  'getPalinsestoSport',
  'getEventoLista',
  'getAvvenimentiSport',
  'getSportList',
  'getListeAvvenimenti',
  'getSportAvvenimenti',
  'getManifestazioneListaAvvenimenti',
  'getListaAvvenimenti',
];

console.log('=== Probe endpoints ===');
for (const ep of CANDIDATES) {
  const paramsToTry = [
    {},
    { sport: '1' },
    { sportId: '1' },
    { pal: '1' },
    { p: '1' },
  ];
  for (const params of paramsToTry) {
    const { j, ms } = await xget(ep, params);
    if (j) {
      const keys = Array.isArray(j) ? `Array(${j.length})` : Object.keys(j).slice(0, 10).join(',');
      const size = JSON.stringify(j).length;
      console.log(`  ✓ ${ep}?${new URLSearchParams(params).toString()} → ${ms}ms size=${size} keys=${keys}`);
      // Compter potentiels matchs si structure semblable
      if (typeof j === 'object') {
        for (const k of Object.keys(j)) {
          if (Array.isArray(j[k]) && j[k].length > 20) {
            console.log(`    ↳ ${k}: Array(${j[k].length})`);
            console.log(`    sample: ${JSON.stringify(j[k][0]).slice(0, 300)}`);
          }
        }
      }
      break; // First working param wins
    }
  }
}

console.log('\n=== Getting widget landing to see all keys ===');
const wc = await xget('getWidgetCentrali');
if (wc.j) {
  console.log(`  wc keys: ${Object.keys(wc.j).join(',')}`);
  if (wc.j.lms) {
    console.log(`  lms sports: ${Object.keys(wc.j.lms).join(',')}`);
    for (const [sp, bucket] of Object.entries(wc.j.lms)) {
      const totalEvs = ['avs','tms','hmv','hgevs','lvs','evs'].reduce((n, k) => n + (Array.isArray(bucket?.[k]) ? bucket[k].length : 0), 0);
      console.log(`    lms[${sp}]: keys=${Object.keys(bucket).join(',')} total-events=${totalEvs}`);
    }
  }
}

console.log('\n=== Trying getPalinsestoBySport variants ===');
for (const params of [
  { idSport: '1' },
  { idSport: '1', idPalinsesto: '-1' },
  { idSport: '1', tipo: 'PRE' },
  { idSport: '1', prematch: 'true' },
  { idsport: '1' },
  { sports: '1' },
]) {
  const { j, ms } = await xget('getPalinsesto', params);
  if (j) {
    const size = JSON.stringify(j).length;
    console.log(`  ${JSON.stringify(params)} → ${ms}ms size=${size}`);
    if (typeof j === 'object' && !Array.isArray(j)) {
      for (const [k, v] of Object.entries(j)) {
        if (Array.isArray(v) && v.length > 5) console.log(`    ${k}: Array(${v.length})`);
      }
    }
  }
}

console.log('\n=== FIN ===');
