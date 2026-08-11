#!/usr/bin/env node
// PROBE SuperGooal (Meridianbet Congo). Test :
//  1) Fetch DIRECT depuis GH Actions IP (Azure eastus) sans proxy
//  2) Fetch via Scrape.do super=true (residentiel) si direct 403
//  3) Structure /leagues + /events/{id} pour comprendre le schema
//
// Sports Meridianbet observes sur d'autres tenants : 58=foot, 55=tennis,
// 56=basket, ??=hockey (a decouvrir). On teste plusieurs sport IDs.

const TOKEN = process.env.SUPERGOOAL_TOKEN || '';
const SD_KEY = process.env.SCRAPE_DO_KEY || '';
const BASE = 'https://online-rr.meridianbet.com';

const H = () => ({
  accept: 'application/json, text/plain, */*',
  'accept-language': 'fr',
  authorization: TOKEN ? `Bearer ${TOKEN}` : undefined,
  origin: 'https://supergooal.cg',
  referer: 'https://supergooal.cg/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
});

async function tryDirect(path) {
  const url = `${BASE}${path}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: H() });
    const txt = await r.text();
    return { status: r.status, len: txt.length, sample: txt.slice(0, 400), ct: r.headers.get('content-type') };
  } catch (e) { return { err: e.message }; }
}

async function tryScrapeDo(path, opts = {}) {
  if (!SD_KEY) return { err: 'no SD key' };
  const target = `${BASE}${path}`;
  const q = new URLSearchParams({
    token: SD_KEY, url: target, customHeaders: 'true',
    ...(opts.super ? { super: 'true' } : {}),
    ...(opts.geo ? { geoCode: opts.geo } : {}),
  });
  const proxied = `https://api.scrape.do/?${q}`;
  try {
    const r = await fetch(proxied, { signal: AbortSignal.timeout(30_000), headers: H() });
    const txt = await r.text();
    return { status: r.status, len: txt.length, sample: txt.slice(0, 400), ct: r.headers.get('content-type') };
  } catch (e) { return { err: e.message }; }
}

console.log(`▶ SuperGooal probe — token=${TOKEN ? 'OK' : 'ABSENT'}  SD_KEY=${SD_KEY ? 'OK' : 'ABSENT'}\n`);

// TEST 1 : sport=58 leagues DIRECT
const paths = [
  '/betshop/api/v1/offer/sport/58/leagues?page=0&time=ONE_DAY',
  '/betshop/api/v1/offer/sport/55/leagues?page=0&time=ONE_DAY',
  '/betshop/api/v1/offer/sport/56/leagues?page=0&time=ONE_DAY',
  '/betshop/api/v1/offer/sport/57/leagues?page=0&time=ONE_DAY',
  '/betshop/api/v1/offer/sport/59/leagues?page=0&time=ONE_DAY',
  '/betshop/api/v2/events/19419809',
];

for (const p of paths) {
  console.log(`\n══ ${p}`);
  const d = await tryDirect(p);
  console.log(`  DIRECT     : status=${d.status ?? 'ERR'} len=${d.len ?? 0} ct=${d.ct || '-'} err=${d.err || '-'}`);
  if (d.status && d.status !== 200) console.log(`    sample=${d.sample}`);
  if (d.status !== 200) {
    const s = await tryScrapeDo(p, { super: true, geo: 'us' });
    console.log(`  SD super=us: status=${s.status ?? 'ERR'} len=${s.len ?? 0} ct=${s.ct || '-'} err=${s.err || '-'}`);
    if (s.status && s.status !== 200) console.log(`    sample=${s.sample}`);
    else if (s.status === 200) console.log(`    OK first 400 chars: ${s.sample}`);
  } else {
    console.log(`    OK first 400 chars: ${d.sample}`);
  }
}

console.log('\n═══ FIN ═══');
process.exit(0);
