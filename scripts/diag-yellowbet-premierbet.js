// Combined diagnostic : YellowBet + PremierBet parse
console.log('==================== YELLOWBET ====================');
try {
  const { stealthGetJson } = await import('../src/net/stealth.js');
  const { fetchJson } = await import('../src/net/fetcher.js');
  const H = { brandid: '122', channelid: '4', language: 'fr', terminal: 'yellowbet.cg' };
  const now = new Date();
  const to = new Date(now.getTime() + 72 * 3600 * 1000);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const url = `https://yellowbet.cg/services/evapi/event/GetEvents?fromDate=${iso(now)}&toDate=${iso(to)}&skip=0&take=500&count=500&pageSize=500`;
  console.log('URL:', url);
  const t0 = Date.now();
  try { const j = await stealthGetJson(url, { headers: H, timeoutMs: 15000 }); console.log('stealth', Date.now()-t0, 'ms; keys=', j?Object.keys(j).slice(0,5):null, 'data.len=', j?.data?.length); }
  catch (e) { console.log('stealth err', e.message); }
  const t1 = Date.now();
  try { const j = await fetchJson(url, { headers: H, timeoutMs: 20000 }); console.log('direct', Date.now()-t1, 'ms; keys=', j?Object.keys(j).slice(0,5):null, 'data.len=', j?.data?.length); }
  catch (e) { console.log('direct err', e.message); }
  const t2 = Date.now();
  try { const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(15000) }); const b = await r.text(); console.log('raw', Date.now()-t2, 'ms status=', r.status, 'len=', b.length, 'start=', b.slice(0, 250)); }
  catch (e) { console.log('raw err', e.message); }
} catch (e) { console.log('yellowbet block err', e.message); }

console.log('\n==================== PREMIERBET ====================');
try {
  const { fetchFeaturedFootball } = await import('../src/bookmakers/premierbet/api.js');
  const { premierbetFlatOdds } = await import('../src/bookmakers/premierbet/parse.js');
  const events = await fetchFeaturedFootball();
  console.log(`Got ${events.length} events`);
  for (let i = 0; i < Math.min(2, events.length); i++) {
    const e = events[i];
    console.log(`\n--- Event ${i}: ${e.eventNames?.join(' vs ')} (markets: ${e.markets?.length}) ---`);
    for (const m of (e.markets || [])) {
      const outs = (m.outcomes || []).slice(0, 8).map((o) => `"${o.name}"=${o.value}`).join(' | ');
      console.log(`  id=${m.id} "${m.name}" [${outs}]`);
    }
    const parsed = premierbetFlatOdds(e.markets || []);
    console.log('PARSED', Object.keys(parsed).length, 'keys:', Object.keys(parsed));
  }
} catch (e) { console.log('premierbet block err', e.message); }
process.exit(0);
