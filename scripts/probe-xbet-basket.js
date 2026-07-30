#!/usr/bin/env node
// Probe 1xbet basketball : pourquoi 0 matchs ?
// Teste GetChampsZip sport=3 + Get1x2_VZip fallback + variantes country/lng

import { fetchJson } from '../src/net/fetcher.js';

const FEED = 'https://1xbet.cg';
const CF_WORKERS = [
  'https://hidden-pine-7436.veolalex3.workers.dev',
  'https://billowing-sea-2d8e.alvecapital60.workers.dev',
];
const HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'fr-FR,fr;q=0.9',
  'content-type': 'application/json',
  origin: FEED,
  referer: `${FEED}/en/line`,
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
  'x-requested-with': 'XMLHttpRequest',
};

async function viaWorker(url, ms = 10000) {
  for (const w of CF_WORKERS) {
    const start = Date.now();
    const j = await fetchJson(`${w}/?url=${encodeURIComponent(url)}`, { headers: HEADERS, timeoutMs: ms });
    console.log(`    ${w.split('.')[0].split('//')[1]} → ${j ? 'JSON('+JSON.stringify(j).length+'b)' : 'null'} in ${Date.now()-start}ms`);
    if (j) return j;
  }
  return null;
}

console.log('=== 1 : GetChampsZip sport=3 (basketball) sur 1xbet.cg country=93 ===');
const champs = await viaWorker(`${FEED}/service-api/LineFeed/GetChampsZip?sport=3&lng=en&country=93&partner=192`);
if (champs) {
  const val = champs?.Value || [];
  console.log(`  Value: ${val.length} champs`);
  console.log(`  samples: ${val.slice(0, 5).map(c => JSON.stringify({LI:c.LI, CI:c.CI, LE:c.LE, L:c.L, C:c.C})).join('\n           ')}`);
}

console.log('\n=== 2 : Top matches Get1x2_VZip sport=3 (fallback quand 0 champs) ===');
const top = await viaWorker(`${FEED}/service-api/LineFeed/Get1x2_VZip?sports=3&count=100&lng=en&mode=4&country=93&partner=192&getEmpty=true`);
if (top) {
  const val = top?.Value || [];
  console.log(`  Value: ${val.length} matches`);
  console.log(`  samples: ${val.slice(0, 3).map(m => `${m.O1} vs ${m.O2} (${m.LE || m.L})`).join('\n           ')}`);
}

console.log('\n=== 3 : test avec country=1 (US/global) ===');
const usFeed = await viaWorker(`${FEED}/service-api/LineFeed/GetChampsZip?sport=3&lng=en&country=1&partner=192`);
if (usFeed) {
  console.log(`  Value: ${(usFeed?.Value || []).length} champs`);
}

console.log('\n=== 4 : test lng=fr et lng=ru ===');
for (const lng of ['fr', 'ru']) {
  const c = await viaWorker(`${FEED}/service-api/LineFeed/GetChampsZip?sport=3&lng=${lng}&country=93&partner=192`);
  console.log(`  lng=${lng}: ${(c?.Value || []).length} champs`);
}

console.log('\n=== 5 : autre domaine 1xbet.com (public) ===');
const alt = await viaWorker(`https://1xbet.com/service-api/LineFeed/GetChampsZip?sport=3&lng=en&country=1&partner=192`);
if (alt) {
  console.log(`  Value: ${(alt?.Value || []).length} champs`);
}

console.log('\n=== 6 : comparaison sport=1 (football) meme URL ===');
const foot = await viaWorker(`${FEED}/service-api/LineFeed/GetChampsZip?sport=1&lng=en&country=93&partner=192`);
console.log(`  Football champs: ${(foot?.Value || []).length}`);

console.log('\n=== 7 : est-ce que le filtre isRealChamp masque tout ? ===');
if (champs?.Value) {
  const raw = champs.Value;
  const passed = raw.filter(c => {
    const name = c.LE || c.L || '';
    return !/spéci|special|alternative|player|joueur|team vs|vs player|winner|vainqueur|to win|outright|long.?term|handicap match|first goalscorer|corner match|booking|cards?( match)?/i.test(name);
  });
  console.log(`  ${raw.length} total → ${passed.length} passent isRealChamp`);
  console.log(`  bloqués:`);
  raw.filter(c => !passed.includes(c)).slice(0, 5).forEach(c => console.log(`    ${c.LE || c.L}`));
}

console.log('\n=== FIN ===');
