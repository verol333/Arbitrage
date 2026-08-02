// Probe sport IDs tennis pour betpawa + premierbet (sportybet=sr:sport:5 confirmé).
// v2 : structure query BetPawa correcte + PremierBet direct guineegames (Scrape.do timeout).

const log = (m) => console.log(m);

// ─── BETPAWA ──────────────────────────────────────────────────────────────
async function probeBetpawa() {
  const HDR = {
    'Accept': 'application/x-protobuf',
    'Accept-Language': 'fr-FR,fr;q=0.7',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36',
    'x-pawa-brand': 'betpawa-congobrazzaville',
    'x-pawa-language': 'fr',
    'Referer': 'https://cg.betpawa.com/events',
    'Cookie': 'bp_country=CG',
  };
  log('\n=== BETPAWA (format categories:[X]) ===');
  for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 20]) {
    try {
      const q = { queries: [{ query: { eventType: 'UPCOMING', categories: [String(id)], zones: {}, hasOdds: true }, view: { marketTypes: ['3743'] }, skip: 0, take: 3 }] };
      const url = `https://cg.betpawa.com/api/sportsbook/v4/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`;
      const res = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(20_000) });
      const buf = new Uint8Array(await res.arrayBuffer());
      const strings = [];
      let cur = '';
      for (let i = 0; i < buf.length; i++) {
        const b = buf[i];
        if (b >= 32 && b <= 126) cur += String.fromCharCode(b);
        else { if (cur.length > 2) strings.push(cur); cur = ''; }
      }
      if (cur.length > 2) strings.push(cur);
      const samples = strings.filter((s) => s.includes(' - ') && !/1X2|UP|LIVE|UPCOMING|FT$/.test(s) && s.length < 80).slice(0, 3);
      log(`  categoryId=${id} → status=${res.status} bytes=${buf.length} samples=${JSON.stringify(samples)}`);
    } catch (e) { log(`  categoryId=${id} → ERR ${e.message}`); }
  }
}

// ─── PREMIERBET (endpoint direct guineegames sans Scrape.do) ─────────────
async function probePremierbet() {
  const HDR = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'fr-FR,fr;q=0.9',
    'Referer': 'https://www.guineegames.com/',
    'Origin': 'https://www.guineegames.com',
  };
  log('\n=== PREMIERBET (guineegames.com direct, sportId=X) ===');
  const params = 'country=GN&group=g6&platform=desktop&locale=fr';
  for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    try {
      const url = `https://sports-api.guineegames.com/v1/events/upcoming?${params}&sportId=${id}&timeOffset=-60&date=${new Date().toISOString().slice(0, 10)}`;
      const res = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(45_000) });
      const txt = await res.text();
      let count = 0, sample = '', sportName = '';
      try {
        const j = JSON.parse(txt);
        const cats = j?.data?.categories || j?.categories || [];
        for (const c of cats) for (const comp of (c?.competitions || [])) count += (comp?.events?.length || 0);
        const ev0 = cats?.[0]?.competitions?.[0]?.events?.[0];
        if (ev0) {
          const names = ev0.competitors?.map((x) => x.name) || [];
          sample = names.length >= 2 ? `${names[0]} vs ${names[1]}` : (ev0.name || '');
        }
        sportName = j?.data?.sport?.name || j?.sport?.name || '';
      } catch {}
      log(`  sportId=${id} → status=${res.status} events=${count} sport="${sportName}" sample="${sample.slice(0, 60)}"`);
    } catch (e) { log(`  sportId=${id} → ERR ${e.message}`); }
  }
}

await probeBetpawa();
await probePremierbet();
log('\nDONE');
