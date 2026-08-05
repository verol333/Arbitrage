#!/usr/bin/env node
// Probe Maxibet v5 — cible le bundle JS index-*.js avec delay pour bypass Jina rate limit
// + tente sister sites (cms, affiliates) + patterns Digitain classiques.
const JINA = process.env.JINA_API_KEY || '';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchJina(url, attempt = 0) {
  try {
    const r = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Authorization: JINA ? `Bearer ${JINA}` : '',
        'X-Return-Format': 'html',
        'X-Respond-With': 'html',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(30000),
    });
    if (r.status === 422 && attempt < 2) {
      await sleep(6000);
      return fetchJina(url, attempt + 1);
    }
    return { status: r.status, text: r.ok ? await r.text() : '' };
  } catch (e) { return { status: 0, err: e.message, text: '' }; }
}

// 1) Home
console.log('═══ HOME → extract main bundle url ═══');
const home = await fetchJina('https://m.maxibet.bet/');
console.log(`home → ${home.status} ${home.text.length}b`);
const bundles = [...home.text.matchAll(/["']([^"']*assets\/index-[^"']+\.js)["']/g)].map(m => m[1]);
console.log(`bundles detectes: ${bundles.join(', ')}`);

// 2) Fetch bundle avec retry
console.log('\n═══ MAIN JS BUNDLE ═══');
for (const b of bundles.slice(0, 2)) {
  const url = b.startsWith('http') ? b : `https://m.maxibet.bet${b.startsWith('/') ? '' : '/'}${b}`;
  await sleep(5000);
  const r = await fetchJina(url);
  console.log(`${url} → ${r.status} ${r.text.length}b`);
  if (r.text.length > 500) {
    // Grep interesting patterns dans le bundle
    for (const pat of [
      /["'`]https?:\/\/[a-z0-9.-]+\/[a-z0-9\/._?=&-]*/gi,
      /wss?:\/\/[a-z0-9.-]+[a-z0-9\/._?=&-]*/gi,
      /["'`](\/api\/[a-z0-9\/._?=&-]+)/gi,
      /partnerId[\s:=]+\d+/gi,
      /siteId[\s:=]+\d+/gi,
      /brandId[\s:=]+\d+/gi,
      /baseUrl[\s:=]+["'`][^"'`]+["'`]/gi,
      /VITE_[A-Z_]+/gi,
    ]) {
      const found = [...new Set([...r.text.matchAll(pat)].map(m => m[0].slice(0, 100)))].slice(0, 10);
      if (found.length) {
        console.log(`  pattern ${pat.source.slice(0,40)} → ${found.length} matches`);
        for (const f of found) console.log(`    ${f}`);
      }
    }
    // Dump les 5000 premiers chars pour voir la config
    console.log('  --- bundle head (2500c) ---');
    console.log(r.text.slice(0, 2500));
  }
}

// 3) Sister sites
console.log('\n═══ SISTER SUBDOMAINS ═══');
for (const url of ['https://cms.maxibet.bet/', 'https://affiliates.maxibet.bet/', 'https://icons.maxibet.bet/']) {
  await sleep(3000);
  const r = await fetchJina(url);
  console.log(`${url} → ${r.status} ${r.text.length}b`);
  if (r.text && r.text.length < 3000) {
    console.log('  ' + r.text.slice(0, 500));
  } else if (r.text) {
    // Grep pour URLs et signatures
    const urls = [...new Set([...r.text.matchAll(/https?:\/\/[a-z0-9.-]+[a-z0-9\/._?=&-]*/gi)].map(m => m[0].slice(0, 100)))].filter(u => !u.includes('google') && !u.includes('cloudflare')).slice(0, 15);
    console.log('  urls:', urls);
  }
}

// 4) Digitain API endpoints candidats
console.log('\n═══ DIGITAIN PATTERN ENDPOINTS ═══');
const DIG_PATHS = [
  '/api/v2/prematch/GetMainSports',
  '/api/v1/prematch/sports',
  '/api/prematch/sports',
  '/sportsbook/v1/config',
  '/sb2/prematch/sports',
  '/api/frontend/game/getEventsBySport',
  '/api/get-sports',
];
for (const path of DIG_PATHS) {
  await sleep(2000);
  const r = await fetchJina('https://m.maxibet.bet' + path);
  const looksLikeJson = r.text.trim().startsWith('{') || r.text.trim().startsWith('[');
  console.log(`  ${path} → ${r.status} ${r.text.length}b ${looksLikeJson ? '(JSON!)' : '(html)'}`);
  if (looksLikeJson) console.log('    ' + r.text.slice(0, 500));
}
