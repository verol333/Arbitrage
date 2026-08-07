#!/usr/bin/env node
// PROBE COUPON CODES — tente de générer un vrai code coupon sur les 7 books
// documentés dans docs/coupon-codes.md (sportybet, congobet, betmomo, betpawa,
// yellowbet, 1xbet, 1win). Chaque book pick 1 match football upcoming (avec fallback
// tennis si aucun foot), sélectionne le 1X2 Home (ou Match Winner Home en tennis),
// appelle SaveCoupon avec les IDs bruts, log le code retourné.
//
// Sortie type :
//   ✅ SPORTYBET   CODE=L3FRZR   Match=X vs Y   Cote=1.85 (1X2 Home)
//   ⚠️  YELLOWBET   HTTP 403      raison=cloudflare
//
// User copie-colle chaque code dans l'app du book pour vérifier.
import WebSocket from 'ws';
import { gotScraping } from 'got-scraping';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36';
const TIMEOUT = 20_000;

const results = {};

async function fetchJson(url, opts = {}) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) },
      method: opts.method || 'GET',
      body: opts.body,
      signal: AbortSignal.timeout(opts.timeout || TIMEOUT),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    return { status: r.status, text, json };
  } catch (e) {
    return { status: 0, err: e.message, text: '', json: null };
  }
}

async function stealthJson(url, opts = {}) {
  try {
    const res = await gotScraping({
      url,
      method: opts.method || 'GET',
      headers: opts.headers || {},
      body: opts.body,
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120 }],
        devices: ['desktop'],
        locales: ['fr-FR'],
        operatingSystems: ['linux'],
      },
      timeout: { request: opts.timeout || TIMEOUT },
      retry: { limit: 0 },
      throwHttpErrors: false,
    });
    let json = null;
    try { json = JSON.parse(res.body); } catch { /* ignore */ }
    return { status: res.statusCode, text: res.body, json };
  } catch (e) {
    return { status: 0, err: e.message, text: '', json: null };
  }
}

const record = (book, ok, info) => {
  results[book] = { ok, ...info };
  const icon = ok ? '✅' : '⚠️';
  const code = info.code ? `CODE=${info.code}` : `HTTP ${info.status || '?'} ${info.err || ''}`;
  const suffix = info.match ? ` | ${info.match} | ${info.selection}` : '';
  console.log(`  ${icon} ${book.toUpperCase().padEnd(11)} ${code}${suffix}`);
  if (info.raw) console.log(`     raw: ${String(info.raw).slice(0, 220)}`);
};

// ═══════════════════════════════════════════════════════════════
// 1) SPORTYBET
// ═══════════════════════════════════════════════════════════════
async function testSportybet() {
  console.log('\n─── SPORTYBET ───');
  const list = await fetchJson(
    'https://www.sportybet.com/api/ng/factsCenter/pcUpcomingEvents' +
    '?sportId=sr:sport:1&marketId=1,18,29,10,11,26,16,60,68&pageNum=1&option=1&_t=' + Date.now()
  );
  const events = list.json?.data?.tournaments?.flatMap(t => t.events || []) || [];
  const pick = events.find(e => {
    const m = e.markets?.find(mk => String(mk.id) === '1');
    const home = m?.outcomes?.find(o => String(o.desc).toLowerCase() === 'home');
    return home && Number(home.odds) > 1.3 && Number(home.odds) < 5;
  });
  if (!pick) return record('sportybet', false, { err: 'no event 1X2 found' });
  const market = pick.markets.find(m => String(m.id) === '1');
  const home = market.outcomes.find(o => String(o.desc).toLowerCase() === 'home');
  const body = JSON.stringify([{ eventId: pick.eventId, marketId: '1', outcomeId: String(home.id) }]);
  const r = await fetchJson('https://www.sportybet.com/api/ng/orders/share', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  const code = r.json?.data?.shareCode;
  record('sportybet', !!code, {
    code, status: r.status,
    match: `${pick.homeTeamName} vs ${pick.awayTeamName}`,
    selection: `1X2 Home @ ${home.odds}`,
    raw: code ? null : r.text,
  });
}

// ═══════════════════════════════════════════════════════════════
// 2) CONGOBET
// ═══════════════════════════════════════════════════════════════
async function testCongobet() {
  console.log('\n─── CONGOBET ───');
  const list = await fetchJson('https://congobet.net/api/events/upcoming?sportId=1&limit=30');
  const events = list.json?.data || list.json || [];
  const pick = (Array.isArray(events) ? events : []).find(e =>
    (e.eventBetTypes || []).some(bt => Number(bt.betTypeId) === 10001 && (bt.eventBetTypeItems || []).length >= 3)
  );
  if (!pick) return record('congobet', false, { err: 'no event with 1X2', status: list.status });
  const bt1x2 = pick.eventBetTypes.find(bt => Number(bt.betTypeId) === 10001);
  const home = bt1x2.eventBetTypeItems.find(it => (it.shortName || '').trim() === '1');
  if (!home) return record('congobet', false, { err: 'no 1X2 outcome "1"' });
  const body = JSON.stringify({
    totalOdds: Number(home.odds),
    eventBetTypeItemIds: [Number(home.id)],
    betCategory: 'SportsFixedOdds',
    betSystemType: 'Simple',
    drawGameSelections: [], manualOddsBoostIds: [], oddsBoostIds: [],
    maxPayout: 300, stakePerLine: [50], totalStake: 50,
    hasBetBuilderBetLines: false,
  });
  const r = await fetchJson('https://hg-betting-api-prod.sporty-tech.net/api/betting/get-my-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://congobet.net', Referer: 'https://congobet.net/' },
    body,
  });
  record('congobet', !!r.json?.code, {
    code: r.json?.code, status: r.status,
    match: `${pick.homeTeamName} vs ${pick.awayTeamName}`,
    selection: `1X2 "1" @ ${home.odds}`,
    raw: r.json?.code ? null : r.text,
  });
}

// ═══════════════════════════════════════════════════════════════
// 3) BETMOMO (SWARM WebSocket, is_booking: true)
// ═══════════════════════════════════════════════════════════════
async function testBetmomo() {
  console.log('\n─── BETMOMO ───');
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://eu-swarm-newm.betconstruct.com/');
    let done = false;
    const finish = (result) => {
      if (done) return; done = true;
      try { ws.close(); } catch { /* ignore */ }
      record('betmomo', !!result?.code, result || { err: 'timeout' });
      resolve();
    };
    const hard = setTimeout(() => finish({ err: 'timeout 25s' }), 25_000);
    const pending = {}; let rid = 0;
    const send = (command, params) => new Promise((res) => {
      const r = 'r' + (++rid); pending[r] = res;
      ws.send(JSON.stringify({ command, params, rid: r }));
    });

    ws.on('open', () => {
      ws.send(JSON.stringify({ command: 'request_session', params: { site_id: 122, language: 'eng' }, rid: 's1' }));
    });
    ws.on('error', () => { clearTimeout(hard); finish({ err: 'ws error' }); });
    ws.on('message', async (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.rid === 's1') {
        if (!m.data?.sid) { clearTimeout(hard); return finish({ err: 'no sid' }); }
        const now = Math.floor(Date.now() / 1000);
        const games = await send('get', {
          source: 'betting',
          what: {
            game: ['id', 'team1_name', 'team2_name', 'start_ts'],
            market: ['id', 'type', 'name'],
            event: ['id', 'price', 'type_1', 'type'],
          },
          where: {
            sport: { id: 1 },
            game: { start_ts: { '@gt': now + 3600, '@lt': now + 172800 }, is_live: 0 },
            market: { type: 'P1XP2' },
          },
        });
        let pick = null;
        for (const s of Object.values(games?.data?.sport || {})) {
          for (const r of Object.values(s.region || {})) {
            for (const c of Object.values(r.competition || {})) {
              for (const g of Object.values(c.game || {})) {
                const m1x2 = Object.values(g.market || {})[0];
                if (!m1x2) continue;
                const home = Object.values(m1x2.event || {}).find(e =>
                  (e.type_1 || e.type) === 'W1' || (e.type_1 || e.type) === '1' || (e.type_1 || e.type) === 'Home'
                );
                if (home && Number(home.price) > 1.5 && Number(home.price) < 3) {
                  pick = { game: g, event: home };
                  break;
                }
              }
              if (pick) break;
            }
            if (pick) break;
          }
          if (pick) break;
        }
        if (!pick) { clearTimeout(hard); return finish({ err: 'no match found' }); }

        const bookRes = await send('do', {
          command: 'place_coupon',
          params: {
            type: 1, source: 12, mode: 5, use_amount_only: 1,
            is_booking: true,
            each_way: [], amount: 0,
            events: [{ event_id: Number(pick.event.id), price: Number(pick.event.price) }],
          },
        }).catch(() => null);
        const code = bookRes?.data?.book_id || bookRes?.data?.bookid || bookRes?.data?.details?.bookid;
        clearTimeout(hard);
        finish({
          code: code ? String(code) : null,
          status: 200,
          match: `${pick.game.team1_name} vs ${pick.game.team2_name}`,
          selection: `1X2 Home @ ${pick.event.price}`,
          raw: code ? null : JSON.stringify(bookRes?.data || bookRes || {}).slice(0, 300),
        });
      } else if (pending[m.rid]) {
        pending[m.rid](m); delete pending[m.rid];
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// 4) BETPAWA (POST /api/sportsbook/v3/booking-number)
// ═══════════════════════════════════════════════════════════════
async function testBetpawa() {
  console.log('\n─── BETPAWA ───');
  // Fetch un event tennis (accès meilleur que foot en ce moment sur BetPawa CG)
  const listResp = await fetchJson(
    'https://cg.betpawa.com/api/sportsbook/v3/events?query=upcoming&categories=452&marketTypes=2043818&take=20',
    { headers: { 'x-pawa-brand': 'betpawa-congobrazzaville', 'x-pawa-language': 'fr' } }
  );
  const events = listResp.json?.responses || listResp.json?.events || listResp.json?.data || [];
  const first = Array.isArray(events) ? events[0] : null;
  if (!first?.id) return record('betpawa', false, { err: 'no event in list', status: listResp.status, raw: listResp.text });
  const detail = await fetchJson(
    `https://cg.betpawa.com/api/sportsbook/v3/events/${first.id}`,
    { headers: { 'x-pawa-brand': 'betpawa-congobrazzaville', 'x-pawa-language': 'fr' } }
  );
  const ev = detail.json;
  const market = ev?.markets?.find(m => String(m.marketType?.id) === '2043818' || String(m.marketType?.id) === '3743');
  const price = market?.row?.[0]?.prices?.find(p => String(p.name).trim() === '1');
  if (!price?.id) return record('betpawa', false, { err: 'no price with id', status: detail.status });
  // Body observé F12 : {selections:[{id: "priceId", price: "1.85"}], eventIds:[eventId]}
  const bodies = [
    JSON.stringify({ selections: [{ id: price.id, price: String(price.odds) }] }),
    JSON.stringify({ selections: [{ id: price.id }] }),
    JSON.stringify({ selections: [{ eventId: String(first.id), marketTypeId: '2043818', priceId: price.id, price: String(price.odds) }] }),
  ];
  for (let i = 0; i < bodies.length; i++) {
    const r = await fetchJson('https://cg.betpawa.com/api/sportsbook/v3/booking-number', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-pawa-brand': 'betpawa-congobrazzaville',
        'x-pawa-language': 'fr',
        Origin: 'https://cg.betpawa.com',
        Referer: 'https://cg.betpawa.com/',
      },
      body: bodies[i],
    });
    const code = r.json?.code || r.json?.bookingNumber || r.json?.bookingCode;
    if (code) return record('betpawa', true, {
      code, status: r.status,
      match: `${ev.name || 'event ' + first.id}`,
      selection: `Winner "1" @ ${price.odds} (body variant ${i + 1})`,
    });
    if (i === bodies.length - 1) return record('betpawa', false, {
      status: r.status, raw: r.text, err: `all ${bodies.length} body variants failed`,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// 5) YELLOWBET (POST /placebetsport isBooking:true)
// ═══════════════════════════════════════════════════════════════
async function testYellowbet() {
  console.log('\n─── YELLOWBET ───');
  const HEADERS = { brandid: '122', channelid: '4', language: 'fr', terminal: 'yellowbet.cg' };
  const list = await stealthJson(
    'https://yellowbet.cg/services/evapi/event/GetEvents?skip=0&take=500&count=500',
    { headers: HEADERS }
  );
  if (list.status !== 200) return record('yellowbet', false, { status: list.status, err: 'GetEvents blocked (CF)', raw: list.text });
  const events = Array.isArray(list.json?.data) ? list.json.data : [];
  const foot = events.filter(e => e.sid === 1 && !e.lv);
  if (!foot.length) return record('yellowbet', false, { err: 'no football prematch' });
  // Pick first with GetEventDetails accessible
  for (const ev of foot.slice(0, 10)) {
    const det = await stealthJson(
      `https://yellowbet.cg/services/evapi/event/GetEventDetails?id=${encodeURIComponent(ev.id)}`,
      { headers: HEADERS }
    );
    const bts = Array.isArray(det.json?.data?.bts) ? det.json.data.bts : [];
    const bt1x2 = bts.find(b => (b.n || '').match(/1x2|match\s*result|full\s*time/i));
    const odds = bt1x2?.odds || bt1x2?.oc || [];
    const home = odds.find(o => (o.n || o.name || '').trim() === '1');
    if (!home) continue;
    const key = `E${ev.id}B${bt1x2.id}O${home.k || home.oddkey || '1'}X`;
    const body = JSON.stringify({
      language: 'fr', acceptOddsChanges: true, isBooking: true,
      bonusIds: [], BetBuilderModel: { BetBuilderEvents: [] },
      rows: [{ amount: 0, selectionKeys: [key] }],
      selections: [{
        key, eventId: Number(ev.id), betTypeId: Number(bt1x2.id),
        betTypeName: bt1x2.n || 'FT 1X2', oddKey: home.k || '1', oddName: '1',
        oddPrice: String(home.p || home.price || home.odd),
        gameTime: ev.d || new Date().toISOString(),
        homeName: ev.h, awayName: ev.a,
        isLive: false, isVirtual: false, eventStatus: 0, betStatus: 0, order: 1,
      }],
      source: '', sourceRef: '', totalStake: 0,
    });
    const r = await stealthJson('https://yellowbet.cg/services/clapi/api/Bet/placebetsport', {
      method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body,
    });
    const code = r.json?.code || r.json?.data?.code;
    return record('yellowbet', !!code, {
      code, status: r.status,
      match: `${ev.h} vs ${ev.a}`,
      selection: `1X2 "1" @ ${home.p}`,
      raw: code ? null : r.text,
    });
  }
  record('yellowbet', false, { err: 'no event with 1X2 details' });
}

// ═══════════════════════════════════════════════════════════════
// 6) 1XBET (POST /service-api/LiveBet/Open/SaveCoupon)
// ═══════════════════════════════════════════════════════════════
async function testOnexbet() {
  console.log('\n─── 1XBET ───');
  // Fetch upcoming foot events via LineFeed
  const line = await fetchJson('https://1xbet.cg/LineFeed/Get1x2_VZip?sports=1&count=50&lng=fr&mode=4&country=93&partner=192');
  const evts = line.json?.Value || [];
  const pick = evts.find(e => e.E > 1.3 && e.E < 5 && e.O1 && e.O2);
  if (!pick) return record('1xbet', false, { err: 'no LineFeed event', status: line.status });
  const gameId = pick.CI || pick.I;
  const body = JSON.stringify({
    Events: [{ GameId: gameId, Type: 1, Coef: pick.E, Param: 0, Kind: 1, PlayerId: 0 }],
    partner: 192, Summ: '100',
  });
  const r = await fetchJson('https://1xbet.cg/service-api/LiveBet/Open/SaveCoupon', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://1xbet.cg',
      Referer: 'https://1xbet.cg/en/line/',
      Accept: 'application/json, text/plain, */*',
    },
    body,
  });
  const code = r.json?.Value;
  record('1xbet', !!code && r.json?.Success !== false, {
    code, status: r.status,
    match: `${pick.O1} vs ${pick.O2}`,
    selection: `1X2 "1" @ ${pick.E}`,
    raw: code ? null : r.text,
  });
}

// ═══════════════════════════════════════════════════════════════
// 7) 1WIN (POST /shared-bets/create)
// ═══════════════════════════════════════════════════════════════
async function testOnewin() {
  console.log('\n─── 1WIN ───');
  // Fetch un match via REST (list-events)
  const list = await fetchJson(
    'https://1win.pro/fe-api/v3/en/line-events?sport=1&lang=en',
    { headers: { Origin: 'https://1win.pro', Referer: 'https://1win.pro/' } }
  );
  const events = list.json?.events || list.json?.data || [];
  const first = Array.isArray(events) ? events[0] : null;
  if (!first?.id) return record('1win', false, { err: 'no line-event', status: list.status, raw: list.text });
  // Get odds detail for the match
  const detail = await fetchJson(
    `https://1win.pro/fe-api/v3/en/line-events/${first.id}?lang=en`,
    { headers: { Origin: 'https://1win.pro', Referer: 'https://1win.pro/' } }
  );
  const groups = detail.json?.oddsGroups || detail.json?.groups || [];
  let oddId = null; let price = null;
  for (const g of groups) {
    for (const o of (g.oddsList || g.odds || [])) {
      if (String(o.outcome) === '1' && Number(o.cf || o.price) > 1.3 && Number(o.cf || o.price) < 5) {
        oddId = o.id; price = Number(o.cf || o.price);
        break;
      }
    }
    if (oddId) break;
  }
  if (!oddId) return record('1win', false, { err: 'no oddId 1X2 "1"' });
  const body = JSON.stringify({
    coupons: [{ oddId }],
    currencyCode: 'USD', l: 'en', p: 'DesktopSite',
  });
  const r = await fetchJson('https://api-gateway.top-parser.com/shared-bets/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://1win.pro', Referer: 'https://1win.pro/',
    },
    body,
  });
  const code = r.json?.result?.code || r.json?.code;
  record('1win', !!code, {
    code, status: r.status,
    match: `${first.team1?.name || first.homeName || '?'} vs ${first.team2?.name || first.awayName || '?'}`,
    selection: `1X2 "1" @ ${price}`,
    raw: code ? null : r.text,
  });
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
console.log('▶ PROBE COUPON CODES — generate real codes for user verification\n');
const tests = [
  ['sportybet', testSportybet],
  ['congobet', testCongobet],
  ['betmomo', testBetmomo],
  ['betpawa', testBetpawa],
  ['yellowbet', testYellowbet],
  ['1xbet', testOnexbet],
  ['1win', testOnewin],
];
for (const [name, fn] of tests) {
  try { await fn(); } catch (e) { record(name, false, { err: e.message, status: 0 }); }
}

console.log('\n═══ RÉCAPITULATIF ═══\n');
for (const [book, r] of Object.entries(results)) {
  const icon = r.ok ? '✅' : '⚠️';
  const short = r.code ? `CODE=${r.code}` : `échec (${r.err || 'HTTP ' + r.status})`;
  console.log(`  ${icon} ${book.padEnd(11)} ${short}`);
  if (r.match && r.selection) console.log(`     ${r.match} | ${r.selection}`);
}
console.log('\n═══ FIN ═══');
