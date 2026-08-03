#!/usr/bin/env node
// Diagnostic approfondi 5 books tennis non-fonctionnels
// YB, SB, PB, BP, 1win

import { fetchJson } from '../src/net/fetcher.js';
import { stealthGetJson } from '../src/net/stealth.js';

// ═══════════════════════════════════════════════════════════════
// 1) YELLOWBET — dump raw markets tennis pour distinguer games/sets
// ═══════════════════════════════════════════════════════════════
console.log('\n════════════ 1) YELLOWBET tennis — dump bts markets structure ════════════');
try {
  const HDR = { brandid: '122', channelid: '4', language: 'fr', terminal: 'yellowbet.cg' };
  const list = await stealthGetJson(
    `https://yellowbet.cg/services/evapi/event/GetEvents?skip=0&take=5&sportId=35&categoryTypeIds=all&langId=fr`,
    { headers: HDR, timeoutMs: 15000 },
  );
  const events = list?.value?.events || list?.events || [];
  console.log(`  ${events.length} events sportId=35 (tennis)`);
  for (const ev of events.slice(0, 2)) {
    console.log(`\n  ─ ${ev.h} vs ${ev.a} (${ev.ln || '?'})`);
    // Fetch bts (bet types) pour ce match
    const bts = await stealthGetJson(
      `https://yellowbet.cg/services/evapi/event/GetEventDetails?eventId=${ev.id}&langId=fr`,
      { headers: HDR, timeoutMs: 15000 },
    );
    const arr = bts?.value?.bts || bts?.bts || [];
    console.log(`    ${arr.length} bts (bet types)`);
    for (const bt of arr.slice(0, 30)) {
      const outs = (bt.bs || []).map(b => `${b.n || b.name || '?'}=${b.o || b.od || b.odd}`).join(' | ');
      console.log(`      btId=${bt.id || '?'} name="${bt.n || bt.name}" line=${bt.l || bt.line || ''} → ${outs.slice(0, 200)}`);
    }
  }
} catch (e) { console.log(`  ERR ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 2) SPORTYBET — retry avec user-agent + timing différents
// ═══════════════════════════════════════════════════════════════
console.log('\n\n════════════ 2) SPORTYBET tennis — diagnostic 403 ════════════');
try {
  const UAS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  ];
  for (const ua of UAS) {
    const ts = Date.now();
    const url = `https://www.sportybet.com/api/ng/factsCenter/pcUpcomingEvents?sportId=sr%3Asport%3A5&marketId=186%2C68%2C89%2C166%2C187%2C189%2C190%2C340&pageSize=100&pageNum=1&option=1&timeline=24&sortOption=SORT_BY_DEFAULT&_t=${ts}`;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': ua, Accept: '*/*',
          Referer: 'https://www.sportybet.com/ng/sport/tennis/today',
          Origin: 'https://www.sportybet.com',
          Cookie: 'locale=en; device-id=b0671631-24f3-4e60-a281-117254ea1551; sb_country=ng',
          clientid: 'web', operid: '2', platform: 'web',
        },
        signal: AbortSignal.timeout(15000),
      });
      const t = await res.text();
      console.log(`  UA=${ua.slice(0, 30)}... : status=${res.status} len=${t.length}`);
      if (res.status === 200) {
        try { const j = JSON.parse(t); const cnt = j?.data?.tournaments?.reduce((a, tr) => a + (tr.events?.length || 0), 0) || 0; console.log(`    ✓ ${cnt} events`); } catch {}
        break;
      }
    } catch (e) { console.log(`  ERR ${e.message}`); }
  }
  // Aussi tester liveOrPrematchEvents (autre endpoint)
  const ts = Date.now();
  const altUrl = `https://www.sportybet.com/api/ng/factsCenter/liveOrPrematchEvents?sportId=sr%3Asport%3A5&_t=${ts}`;
  const res2 = await fetch(altUrl, {
    headers: {
      'User-Agent': UAS[0], Accept: '*/*',
      Referer: 'https://www.sportybet.com/ng/sport/tennis/today',
      Cookie: 'locale=en; sb_country=ng', clientid: 'web', operid: '2', platform: 'web',
    },
  });
  console.log(`  liveOrPrematchEvents : status=${res2.status}`);
} catch (e) { console.log(`  ERR ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 3) PREMIERBET (guineegames) — élargir dates + regarder cross-book potentiel
// ═══════════════════════════════════════════════════════════════
console.log('\n\n════════════ 3) PREMIERBET tennis — elargir dates + top matchs ════════════');
try {
  const HDR = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://www.guineegames.com/',
  };
  const params = 'country=GN&group=g6&platform=desktop&locale=fr';
  // Test date +1, +2, +3 jours
  const now = new Date();
  for (let d = 0; d <= 3; d++) {
    const date = new Date(now.getTime() + d * 86400000).toISOString().slice(0, 10);
    const url = `https://sports-api.guineegames.com/v1/events/upcoming?${params}&sportId=5&timeOffset=-60&date=${date}`;
    const j = await fetchJson(url, { headers: HDR, timeoutMs: 15000 });
    let count = 0; const names = [];
    for (const c of (j?.data?.categories || [])) {
      for (const comp of (c.competitions || c.tournaments || [])) {
        for (const e of (comp.events || [])) {
          count++;
          if (names.length < 3) {
            const nms = e.competitors?.map(x => x.name) || e.eventNames || [];
            names.push(`${nms[0]} vs ${nms[1]} [${c.name}]`);
          }
        }
      }
    }
    console.log(`  date=${date}: ${count} events. Ex: ${names.join(' | ')}`);
  }
  // Test highlights (top matches)
  const hl = await fetchJson(`https://sports-api.guineegames.com/v1/events/highlights?${params}&sportId=5`, { headers: HDR, timeoutMs: 15000 });
  let hlCount = 0; const hlNames = [];
  for (const c of (hl?.data?.categories || [])) for (const comp of (c.competitions || [])) for (const e of (comp.events || [])) {
    hlCount++;
    if (hlNames.length < 3) {
      const nms = e.competitors?.map(x => x.name) || e.eventNames || [];
      hlNames.push(`${nms[0]} vs ${nms[1]} [${c.name}]`);
    }
  }
  console.log(`  highlights: ${hlCount} events. Ex: ${hlNames.join(' | ')}`);
} catch (e) { console.log(`  ERR ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 4) BETPAWA — tester régions .ke .ug .gh .cm avec bons headers
// ═══════════════════════════════════════════════════════════════
console.log('\n\n════════════ 4) BETPAWA tennis — probe multi-region ════════════');
try {
  const regions = [
    { host: 'ke.betpawa.com', brand: 'betpawa-kenya', lang: 'en' },
    { host: 'ug.betpawa.com', brand: 'betpawa-uganda', lang: 'en' },
    { host: 'gh.betpawa.com', brand: 'betpawa-ghana', lang: 'en' },
    { host: 'ng.betpawa.com', brand: 'betpawa-nigeria', lang: 'en' },
    { host: 'tz.betpawa.com', brand: 'betpawa-tanzania', lang: 'en' },
    { host: 'cm.betpawa.com', brand: 'betpawa-cameroon', lang: 'en' },
  ];
  // Tennis SportRadar = sr:sport:5 → categoryId chez BetPawa souvent = 4 ou 5
  for (const r of regions) {
    for (const catId of [4, 5, 6]) {
      const q = { queries: [{ query: { eventType: 'UPCOMING', categories: [String(catId)], zones: {}, hasOdds: true }, view: { marketTypes: ['3743'] }, skip: 0, take: 3 }] };
      const url = `https://${r.host}/api/sportsbook/v4/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`;
      try {
        const res = await fetch(url, {
          headers: {
            'Accept': 'application/x-protobuf',
            'Accept-Language': r.lang,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0 Safari/537.36',
            'x-pawa-brand': r.brand,
            'x-pawa-language': r.lang,
            'Referer': `https://${r.host}/events`,
          },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) { console.log(`  ${r.host} cat=${catId}: status=${res.status}`); continue; }
        const buf = new Uint8Array(await res.arrayBuffer());
        const strs = []; let cur = '';
        for (let i = 0; i < buf.length; i++) { const b = buf[i]; if (b >= 32 && b <= 126) cur += String.fromCharCode(b); else { if (cur.length > 2) strs.push(cur); cur = ''; } }
        const pairs = [];
        for (let i = 0; i < strs.length - 1; i++) if (/^\d{7,10}$/.test(strs[i]) && strs[i + 1].includes(' - ')) pairs.push(strs[i + 1]);
        const uniq = [...new Set(pairs)];
        const tennisLike = uniq.filter(p => /berrettini|fritz|sinner|alcaraz|djokovic|sabalenka|swiatek|singles|atp|wta|open|challenger/i.test(p));
        console.log(`  ${r.host} cat=${catId}: ${uniq.length} matchs, ${tennisLike.length} tennis-like${tennisLike.length ? ' — ex: ' + tennisLike.slice(0, 2).join(' | ') : ''}`);
      } catch (e) { console.log(`  ${r.host} cat=${catId}: ERR ${e.message}`); }
    }
  }
} catch (e) { console.log(`  ERR ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 5) 1WIN — cross-check si vrai tennis existe (sportId autre que 24, 33)
// ═══════════════════════════════════════════════════════════════
console.log('\n\n════════════ 5) 1WIN tennis — chercher endpoint alternatif ATP ════════════');
try {
  const { API_BASE, ORIGIN, UA, PLATFORM } = await import('../src/bookmakers/onewin/api.js');
  // Endpoints alternatifs top-parser + 1win
  const alt = [
    { name: 'top-parser matches/get', body: { locale: 'en-001', platform: PLATFORM } },
    { name: 'events?sport=tennis', url: `${API_BASE}/matches/get-many` },
  ];
  // Chercher si tennis "sr:sport:5" existe
  for (const sid of [200, 300, 500, 5, 'sr:sport:5', 'tennis']) {
    try {
      const body = { sportId: sid, startAtFrom: Math.floor(Date.now()/1000) - 3600, startAtTo: Math.floor(Date.now()/1000) + 259200, limit: 20, offset: 0, l: 'en-001', p: PLATFORM };
      const res = await fetch(`${API_BASE}/matches/get-many`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Referer: `${ORIGIN}/`, 'User-Agent': UA },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      const d = res.ok ? await res.json() : null;
      const items = d?.result?.items || [];
      console.log(`  sportId=${sid}: status=${res.status} items=${items.length}`);
      if (items.length > 0) {
        const first = items[0];
        console.log(`    ex: ${first.homeTeam?.name || first.team1?.name} vs ${first.awayTeam?.name || first.team2?.name} (${first.tournament?.name || first.category?.slug})`);
      }
    } catch (e) { console.log(`  sportId=${sid}: ERR ${e.message}`); }
  }
  // Chercher un endpoint /categories ou /sports
  console.log('\n  Chercher endpoints listing :');
  for (const path of ['/sports/get-all', '/categories/get-all', '/sports', '/categories']) {
    try {
      const res = await fetch(`${API_BASE}${path}`, { headers: { Origin: ORIGIN, 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      console.log(`    ${path}: status=${res.status}`);
      if (res.ok) {
        const t = await res.text();
        console.log(`      len=${t.length} preview=${t.slice(0, 200)}`);
      }
    } catch (e) { console.log(`    ${path}: ERR ${e.message}`); }
  }
} catch (e) { console.log(`  ERR ${e.message}`); }

console.log('\n═══════════════ FIN DIAG 5 BOOKS ═══════════════');
