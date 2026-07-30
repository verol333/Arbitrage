#!/usr/bin/env node
// Probe sportcash v3 : trouver l'URL pari + endpoints XHR reels
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

console.log('=== 1 : scan sportcash.ci page racine ===');
for (const path of ['/', '/paris', '/paris/football', '/scommesse', '/betting', '/betting/football', '/paris-sportifs', '/paris-sportifs/football']) {
  const res = await fetch(`https://sportcash.ci${path}`, { headers: HDR });
  console.log(`  ${path}: status=${res.status} len=${(await res.text()).length}`);
}

console.log('\n=== 2 : fetch page racine, grep endpoints ===');
const res = await fetch('https://sportcash.ci/', { headers: HDR });
const html = await res.text();
console.log(`  / status=${res.status} len=${html.length}`);
const xhrs = new Set([...html.matchAll(/XSportDatastore\/(\w+)/g)].map(m => m[1]));
console.log(`  ${xhrs.size} endpoints XHR trouves:`);
[...xhrs].sort().forEach(e => console.log(`    ${e}`));

console.log('\n=== 3 : fetch les JS bundles pour extraire endpoints ===');
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
console.log(`  ${scripts.length} scripts references`);
scripts.slice(0, 8).forEach(s => console.log(`    ${s}`));

const jsEndpoints = new Set();
for (const script of scripts.slice(0, 5)) {
  const url = script.startsWith('http') ? script : `https://sportcash.ci${script}`;
  try {
    const r = await fetch(url, { headers: HDR });
    const t = await r.text();
    for (const m of t.matchAll(/["'`](\w{3,30})["'`]/g)) {
      const w = m[1];
      if (/^get[A-Z]\w+/.test(w) || /^find[A-Z]\w+/.test(w) || /^search[A-Z]\w+/.test(w)) jsEndpoints.add(w);
    }
    for (const m of t.matchAll(/XSportDatastore\/(\w+)/g)) jsEndpoints.add(m[1]);
    console.log(`    ${url.split('/').pop()}: ${t.length}b`);
  } catch (e) { console.log(`    ${url}: ERR ${e.message}`); }
}
console.log(`\n  ${jsEndpoints.size} identifiants get*/find*/search* dans JS :`);
[...jsEndpoints].sort().forEach(e => console.log(`    ${e}`));

console.log('\n=== 4 : essayer les nouveaux endpoints trouves avec sport=1 ===');
const CANDIDATES = [...jsEndpoints].filter(e => /avvenim|palin|manif|evento|event|sport/i.test(e));
for (const ep of CANDIDATES.slice(0, 20)) {
  const paramsToTry = [
    {}, { sport: '1' }, { pal: '1' }, { idSport: '1' },
    { p: '1' }, { manif: '1' }, { spid: '1' },
  ];
  for (const params of paramsToTry) {
    const { j, ms } = await xget(ep, params);
    if (j) {
      const size = JSON.stringify(j).length;
      const type = Array.isArray(j) ? `Array(${j.length})` : `Obj(${Object.keys(j).slice(0,5).join(',')})`;
      if (size > 100) {
        console.log(`  ✓ ${ep}?${new URLSearchParams(params).toString()} → ${ms}ms ${type} size=${size}`);
        if (Array.isArray(j) && j.length > 0) console.log(`    sample: ${JSON.stringify(j[0]).slice(0, 250)}`);
        break;
      }
    }
  }
}

console.log('\n=== FIN ===');
