// Dernier essai Betclic.ci : Scrape.do geoCode=CI (super proxy, 10cr/req)
// pour simuler une IP ivoirienne (Akamai probablement geo-locked)
const TOKEN = process.env.SCRAPE_DO_KEY;
if (!TOKEN) { console.log('SCRAPE_DO_KEY missing'); process.exit(1); }

async function scrapeGeo(url, geoCode, timeoutMs = 60_000) {
  const t0 = Date.now();
  const qs = new URLSearchParams({ token: TOKEN, url, geoCode, super: 'true' }).toString();
  try {
    const res = await fetch(`https://api.scrape.do/?${qs}`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.text();
    return { url, geoCode, elapsed: Date.now() - t0, status: res.status, len: body.length, body };
  } catch (e) { return { url, geoCode, elapsed: Date.now() - t0, error: e.message }; }
}

// 1) tester homepage avec geoCode=CI super proxy
console.log('=== TEST geoCode=ci super (10cr) sur www.betclic.ci ===');
const r = await scrapeGeo('https://www.betclic.ci/', 'ci');
console.log(`  status=${r.status} len=${r.len} elapsed=${r.elapsed}ms`);
console.log(`  start: ${(r.body || r.error || '').slice(0, 500).replace(/\s+/g, ' ')}`);

if (r.status === 200 && r.body && r.body.includes('<html')) {
  console.log('\n  ✅ HOMEPAGE ACCESSIBLE via geoCode=ci\n  --- Extract URLs API depuis HTML ---');
  const apiUrls = new Set();
  for (const m of r.body.matchAll(/https?:\/\/[a-z0-9.-]*betclic[a-z0-9.-]*(?:\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=%-]*)?/gi)) {
    const u = m[0].replace(/["'\\]/g, '').slice(0, 200);
    apiUrls.add(u);
  }
  for (const u of [...apiUrls].filter((u) => /api|offer|cdn|sports/i.test(u)).slice(0, 40)) console.log('    ' + u);
  // Scripts embedded
  for (const m of r.body.matchAll(/(apiUrl|apiBaseUrl|apiEndpoint|SERVICE_URL|OFFER_URL|CDN_URL|serviceUrl|offerUrl)["'\s:=]+["']?(https?:\/\/[^"'\s,)]+)/gi)) {
    console.log('  CFG:', m[1], '=', m[2]);
  }
  // Global env
  for (const m of r.body.matchAll(/window\.__INITIAL_STATE__\s*=/g)) console.log('  has window.__INITIAL_STATE__');
  for (const m of r.body.matchAll(/window\.env\s*=\s*({[^}]{10,500}})/g)) console.log('  window.env =', m[1].slice(0, 400));
} else {
  console.log('\n  ❌ Toujours bloqué. Betclic.ci reste inaccessible.');
}
process.exit(0);
