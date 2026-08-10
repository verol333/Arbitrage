#!/usr/bin/env node
// PROBE CASONGO NO-AUTH — trouver un accès aux matchs foot sans JWT.
// 3 pistes : (1) HTML SSR __NEXT_DATA__, (2) endpoints /hapi/velisports/public/*,
// (3) Jina r.jina.ai reader.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

async function req(url, opts = {}) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
    return { status: res.status, body: await res.text(), ct: res.headers.get('content-type') };
  } catch (e) { return { status: 0, body: null, err: e.message }; }
}

// ═════ 1. Casongo.cg HTML SSR — check __NEXT_DATA__ ═════
console.log('══ 1. CASONGO.CG HTML — Next.js SSR data ══\n');
const pages = [
  'https://casongo.cg/fr-CG',
  'https://casongo.cg/fr-CG/paris-sportifs',
  'https://casongo.cg/fr-CG/sports',
  'https://casongo.cg/fr-CG/sports/football',
  'https://casongo.cg/fr-CG/football',
];
for (const url of pages) {
  const r = await req(url);
  console.log(`  [${r.status}] len=${r.body?.length || 0} ${url}`);
  if (r.status !== 200 || !r.body) continue;
  // __NEXT_DATA__
  const nd = r.body.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nd) {
    console.log(`     __NEXT_DATA__ trouvé (${nd[1].length}B)`);
    try {
      const j = JSON.parse(nd[1]);
      console.log(`     top keys: ${Object.keys(j).slice(0, 10).join(', ')}`);
      if (j.props?.pageProps) console.log(`     pageProps keys: ${Object.keys(j.props.pageProps).slice(0, 10).join(', ')}`);
      // Cherche matchs/events dans les données
      const jStr = JSON.stringify(j);
      const hasMatches = /"MI":\s*\d+|"matchId"|"event(?:Id)?":\s*\d+|"fixtures?":\s*\[/i.test(jStr);
      console.log(`     contient données matchs: ${hasMatches ? 'OUI' : 'NON'}`);
      if (hasMatches) {
        const sample = jStr.match(/\{[^{}]*"MI"[^{}]*\}/);
        if (sample) console.log(`     sample: ${sample[0].slice(0, 400)}`);
      }
    } catch (e) { console.log(`     parse err: ${e.message}`); }
  }
  // Cherche autres data
  if (r.body.includes('velisports')) console.log('     mention "velisports"');
  const iframes = [...r.body.matchAll(/<iframe[^>]*src=["']([^"']+)["']/gi)].map((m) => m[1]);
  if (iframes.length) console.log(`     iframes: ${iframes.slice(0, 3).join(' | ')}`);
}

// ═════ 2. Endpoints /hapi/velisports/public/* (sans JWT) ═════
console.log('\n══ 2. /hapi/velisports/public/* SANS token ══\n');
const publicPaths = [
  '/hapi/velisports/public/start_game?deviceType=desktop&internalGameId=1000%3ADESKTOP_AND_MOBILE%3Avelisports%3Avelisports&lang=fr&brandId=paridirect&currency=XAF&country=CG',
  '/hapi/velisports/public/tree?SportId=1&PartnerName=casongo&CurrencyId=XAF&LanguageId=fr',
  '/hapi/velisports/public/prematch?SportId=1&PartnerName=casongo&CurrencyId=XAF',
  '/hapi/velisports/public/matches?SportId=1&PartnerName=casongo',
  '/hapi/velisports/public/sports?PartnerName=casongo',
  '/hapi/velisports/public/events?SportId=1&PartnerName=casongo',
  '/hapi/velisports/anonymous/tree?SportId=1&PartnerName=casongo',
  '/hapi/velisports/guest/tree?SportId=1&PartnerName=casongo',
];
for (const p of publicPaths) {
  const r = await req(`https://casongo.cg${p}`, { headers: { Accept: 'application/json' } });
  const status = r.status === 200 ? '✅' : `⚠️ ${r.status}`;
  console.log(`  [${status}] len=${r.body?.length || 0} ${p.slice(0, 100)}`);
  if (r.body && r.body.length < 1500) console.log(`     ${r.body.slice(0, 500).replace(/\s+/g, ' ')}`);
}

// ═════ 3. Jina reader sur casongo.cg ═════
console.log('\n══ 3. JINA READER (r.jina.ai) ══\n');
const jinaTargets = [
  'https://r.jina.ai/https://casongo.cg/fr-CG',
  'https://r.jina.ai/https://casongo.cg/fr-CG/sports/football',
  'https://r.jina.ai/https://prod-api.velisports.com/websitewebapi/WebSite/GetPrematchTree?SportId=1&CurrencyId=XAF&LanguageId=fr&PartnerId=2&PartnerName=casongo&TimeZone=1',
];
for (const url of jinaTargets) {
  const r = await req(url, { timeoutMs: 40_000 });
  console.log(`  [${r.status}] len=${r.body?.length || 0} ${url.slice(0, 100)}`);
  if (r.status === 200 && r.body) {
    const hasMatch = /\b(vs|contre|-)\b/.test(r.body) && /\d+[.,]\d+/.test(r.body);
    console.log(`     contient matchs+cotes: ${hasMatch ? 'OUI' : 'NON'}`);
    console.log(`     preview: ${r.body.slice(0, 500).replace(/\s+/g, ' ')}`);
  }
}

console.log('\n▶ Fin.');
process.exit(0);
