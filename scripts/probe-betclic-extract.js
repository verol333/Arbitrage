// Extract API endpoints depuis HTML rendered de betclic.ci (geoCode=ci)
const TOKEN = process.env.SCRAPE_DO_KEY;
const qs = new URLSearchParams({ token: TOKEN, url: 'https://www.betclic.ci/', geoCode: 'ci', super: 'true' }).toString();
console.log('Fetching homepage via geoCode=ci...');
const res = await fetch(`https://api.scrape.do/?${qs}`, { signal: AbortSignal.timeout(60_000) });
const body = await res.text();
console.log(`status=${res.status} len=${body.length}`);

// Toutes URLs http(s) du HTML
const allUrls = new Set();
for (const m of body.matchAll(/https?:\/\/[a-zA-Z0-9.\-]+(?:\/[a-zA-Z0-9._~!$&'()*+,;=:@%\/?#-]*)?/g)) allUrls.add(m[0].slice(0, 200));
console.log(`\nTotal unique URLs: ${allUrls.size}`);

// Grouper par hostname
const byHost = new Map();
for (const u of allUrls) {
  try { const h = new URL(u).hostname; byHost.set(h, (byHost.get(h) || 0) + 1); } catch {}
}
console.log('\n=== HOSTS ===');
for (const [h, n] of [...byHost.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(3)}× ${h}`);

// URLs betclic + APIs likely
console.log('\n=== BETCLIC URLS (jusqu\'à 60) ===');
const bcl = [...allUrls].filter((u) => u.includes('betclic')).slice(0, 60);
for (const u of bcl) console.log('  ' + u);

// Chercher les config vars typiques SPA
console.log('\n=== SPA CONFIG VARS ===');
const patterns = [
  /apiUrl["'\s:=]+["']?(https?:\/\/[^"'\s,)]+)/g,
  /apiBaseUrl["'\s:=]+["']?(https?:\/\/[^"'\s,)]+)/g,
  /serviceUrl["'\s:=]+["']?(https?:\/\/[^"'\s,)]+)/g,
  /offerUrl["'\s:=]+["']?(https?:\/\/[^"'\s,)]+)/g,
  /baseUrl["'\s:=]+["']?(https?:\/\/[^"'\s,)]+betclic[^"'\s,)]+)/g,
  /"(https?:\/\/[a-z0-9.-]*offer[a-z0-9.-]*betclic[a-z0-9.-]*[^"]*)"/g,
  /"(https?:\/\/[a-z0-9.-]*api[a-z0-9.-]*betclic[a-z0-9.-]*[^"]*)"/g,
  /"(https?:\/\/[a-z0-9.-]*sports[a-z0-9.-]*betclic[a-z0-9.-]*[^"]*)"/g,
];
for (const p of patterns) {
  for (const m of body.matchAll(p)) console.log(`  ${p.source.slice(0, 30)} → ${m[1].slice(0, 150)}`);
}

// Recherche des chaines "sitecode", "countrycode", "application" (params typiques betclic)
console.log('\n=== BETCLIC PARAMS (context) ===');
for (const p of ['sitecode=', 'countrycode=', 'application=', 'offer.cdn']) {
  const i = body.indexOf(p);
  if (i > 0) console.log(`  "${p}" trouvé à index ${i}: ...${body.slice(Math.max(0, i - 30), i + 80).replace(/\s+/g, ' ')}...`);
}

// Regex très large pour chopper toutes chaines "https:..."
const rawStrings = [...body.matchAll(/"(https?:\\?\/\\?\/[^"]{10,200})"/g)]
  .map((m) => m[1].replace(/\\\//g, '/'))
  .filter((u) => /betclic|offer|cdn|api|sports/i.test(u));
console.log(`\n=== BROAD STRING MATCHES (${rawStrings.length}) — first 30 ===`);
for (const u of [...new Set(rawStrings)].slice(0, 30)) console.log('  ' + u);

process.exit(0);
