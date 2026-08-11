#!/usr/bin/env node
// PROBE SuperGooal (Meridianbet Congo). Test :
//  1) Fetch DIRECT depuis GH Actions IP (Azure eastus) sans proxy
//  2) Fallback Jina Reader (r.jina.ai) si direct 403
//  3) Scrape.do super=true en dernier recours (quota epuise actuellement)
//
// Endpoints testes :
//   - online-rr.meridianbet.com/betshop/api/v1/offer/sport/{id}/leagues (auth JWT)
//   - arena-live-stream.meridianbet.com/api/events (public, no auth)
//   - online-rr.meridianbet.com/betshop/api/v2/events/{id} (CF challenge)

const TOKEN = process.env.SUPERGOOAL_TOKEN || '';
const SD_KEY = process.env.SCRAPE_DO_KEY || '';
const JINA = process.env.JINA_API_KEY || '';

const H = (needAuth) => {
  const h = {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'fr-FR,fr;q=0.8',
    origin: 'https://supergooal.cg',
    referer: 'https://supergooal.cg/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  };
  if (needAuth && TOKEN) h.authorization = `Bearer ${TOKEN}`;
  return h;
};

async function tryDirect(url, needAuth = false) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: H(needAuth) });
    const txt = await r.text();
    return { status: r.status, len: txt.length, sample: txt.slice(0, 500), ct: r.headers.get('content-type') };
  } catch (e) { return { err: e.message }; }
}

async function tryJina(url) {
  const jinaUrl = `https://r.jina.ai/${url}`;
  try {
    const headers = { accept: 'application/json, text/plain, */*' };
    if (JINA) headers.authorization = `Bearer ${JINA}`;
    const r = await fetch(jinaUrl, { signal: AbortSignal.timeout(30_000), headers });
    const txt = await r.text();
    return { status: r.status, len: txt.length, sample: txt.slice(0, 800), ct: r.headers.get('content-type') };
  } catch (e) { return { err: e.message }; }
}

console.log(`▶ SuperGooal probe — token=${TOKEN ? 'OK' : 'ABSENT'}  JINA=${JINA ? 'OK' : 'ABSENT'}\n`);

const targets = [
  { url: 'https://arena-live-stream.meridianbet.com/api/events?imgArena=false&merbet=true&infront=false&betRadar=false&betBazar=true&betRadarCountryCodes=CG&mappedEvents=true&betRadarDevice=Desktop&website=https://supergooal.cg&statsPerform=false', auth: false, name: 'ARENA /events (LIVE, no auth)' },
  { url: 'https://online-rr.meridianbet.com/betshop/api/v1/offer/sport/58/leagues?page=0&time=ONE_DAY', auth: true, name: 'ONLINE-RR /leagues sport=58 (auth)' },
  { url: 'https://online-rr.meridianbet.com/betshop/api/v1/offer/sport/55/leagues?page=0&time=ONE_DAY', auth: true, name: 'ONLINE-RR /leagues sport=55' },
  { url: 'https://online-rr.meridianbet.com/betshop/api/v1/offer/sport/56/leagues?page=0&time=ONE_DAY', auth: true, name: 'ONLINE-RR /leagues sport=56' },
  { url: 'https://online-rr.meridianbet.com/betshop/api/v2/events/19419809', auth: false, name: 'ONLINE-RR /events/19419809 (CF)' },
];

for (const t of targets) {
  console.log(`\n══ ${t.name}`);
  const d = await tryDirect(t.url, t.auth);
  console.log(`  DIRECT : status=${d.status ?? 'ERR'} len=${d.len ?? 0} ct=${d.ct || '-'} err=${d.err || '-'}`);
  if (d.sample) console.log(`    sample=${d.sample.slice(0, 300)}`);
  if (d.status !== 200) {
    const j = await tryJina(t.url);
    console.log(`  JINA   : status=${j.status ?? 'ERR'} len=${j.len ?? 0} ct=${j.ct || '-'} err=${j.err || '-'}`);
    if (j.sample) console.log(`    sample=${j.sample.slice(0, 500)}`);
  }
}

console.log('\n═══ FIN ═══');
process.exit(0);
