#!/usr/bin/env node
// PROBE COUPON CODES v2 — utilise les VRAIS endpoints/headers extraits des modules prod
// (src/bookmakers/*/api.js), pour chaque book :
// 1) fetch 1 match football prematch valide
// 2) selectionne 1X2 Home (ou Match Winner)
// 3) POST SaveCoupon/booking-number/etc avec IDs bruts + headers auth session
// 4) log code coupon ou raison de l'echec
import WebSocket from 'ws';
import { gotScraping } from 'got-scraping';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36';
const results = {};

async function fetchRaw(url, opts = {}) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, ...(opts.headers || {}) },
      method: opts.method || 'GET',
      body: opts.body,
      signal: AbortSignal.timeout(opts.timeout || 20_000),
    });
    const buf = await r.arrayBuffer();
    const text = new TextDecoder().decode(buf);
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    return { status: r.status, text, json, buf: new Uint8Array(buf) };
  } catch (e) {
    return { status: 0, err: e.message, text: '', json: null };
  }
}

async function stealthRaw(url, opts = {}) {
  try {
    const res = await gotScraping({
      url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body,
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120 }],
        devices: ['desktop'], locales: ['fr-FR'], operatingSystems: ['linux'],
      },
      timeout: { request: opts.timeout || 20_000 },
      retry: { limit: 0 }, throwHttpErrors: false,
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
  if (info.raw) console.log(`     raw: ${String(info.raw).slice(0, 250)}`);
  if (info.url) console.log(`     url: ${info.url}`);
};

// ═══════════════════════════════════════════════════════════════
// 1) SPORTYBET
// ═══════════════════════════════════════════════════════════════
const SB_HDR = {
  Accept: '*/*',
  'Accept-Language': 'en',
  Referer: 'https://www.sportybet.com/ng/sport/football/today',
  Origin: 'https://www.sportybet.com',
  Cookie: 'locale=en; device-id=b0671631-24f3-4e60-a281-117254ea1551; sb_country=ng',
  clientid: 'web', operid: '2', platform: 'web',
};
async function testSportybet() {
  console.log('\n─── SPORTYBET ───');
  const list = await fetchRaw(
    'https://www.sportybet.com/api/ng/factsCenter/pcUpcomingEvents?sportId=sr:sport:1' +
    '&marketId=1,18,10,29,11,26,36,14,60100&pageNum=1&option=1&_t=' + Date.now(),
    { headers: SB_HDR }
  );
  if (!list.json?.data?.tournaments) return record('sportybet', false, { status: list.status, raw: list.text.slice(0, 200) });
  const events = list.json.data.tournaments.flatMap(t => t.events || []);
  // Filtre : evenement futur (>1h), 1X2 dispo, cote raisonnable
  const now = Date.now();
  const pick = events.find(e => {
    if (e.estimateStartTime && e.estimateStartTime < now + 3_600_000) return false;
    const m = e.markets?.find(mk => String(mk.id) === '1');
    const home = m?.outcomes?.find(o => String(o.desc).toLowerCase() === 'home');
    return home && Number(home.odds) > 1.4 && Number(home.odds) < 4;
  });
  if (!pick) return record('sportybet', false, { err: `${events.length} evts mais 0 valide` });
  const market = pick.markets.find(m => String(m.id) === '1');
  const home = market.outcomes.find(o => String(o.desc).toLowerCase() === 'home');
  const productId = market.product || market.productId || 3;
  const body = JSON.stringify([{
    eventId: pick.eventId, marketId: '1', outcomeId: String(home.id),
    productId, specifier: market.specifier || '',
  }]);
  const r = await fetchRaw('https://www.sportybet.com/api/ng/orders/share', {
    method: 'POST',
    headers: { ...SB_HDR, 'Content-Type': 'application/json' },
    body,
  });
  const code = r.json?.data?.shareCode;
  record('sportybet', !!code, {
    code, status: r.status,
    match: `${pick.homeTeamName} vs ${pick.awayTeamName}`,
    selection: `1X2 Home @ ${home.odds}`,
    url: code ? `https://sportybet.com/ng/?shareCode=${code}` : null,
    raw: code ? null : r.text.slice(0, 200),
  });
}

// ═══════════════════════════════════════════════════════════════
// 2) CONGOBET  (endpoint : hg-event-api-prod.sporty-tech.net)
// ═══════════════════════════════════════════════════════════════
const CB_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'fr-FR,fr;q=0.9',
  origin: 'https://www.congobet.net',
  referer: 'https://www.congobet.net/sports',
};
async function testCongobet() {
  console.log('\n─── CONGOBET ───');
  // Etape 1 : lister les catégories foot
  const cats = await fetchRaw('https://hg-event-api-prod.sporty-tech.net/api/eventCategories/101?l=fr', { headers: CB_HEADERS });
  const leaves = [];
  const walk = (n) => {
    const s = n.subCategories || [];
    if (!s.length) { if ((n.eventsCount || 0) > 0) leaves.push(n.id); }
    else s.forEach(walk);
  };
  (cats.json || []).forEach(walk);
  if (!leaves.length) return record('congobet', false, { err: 'no leaf cats', status: cats.status });
  // Etape 2 : events dans première leaf avec 1X2
  const url = `https://hg-event-api-prod.sporty-tech.net/api/events?eventCategoryIds=${leaves.slice(0, 3).join(',')}&betTypeId=10001&l=fr&skip=0&take=30`;
  const evList = await fetchRaw(url, { headers: CB_HEADERS });
  const evts = Array.isArray(evList.json) ? evList.json : (evList.json?.items || evList.json?.data || []);
  if (!evts.length) return record('congobet', false, { err: 'no events', status: evList.status, raw: evList.text.slice(0, 200) });
  // Etape 3 : fetch details du 1er event pour avoir eventBetTypeItems
  let pick = null; let items = null;
  for (const ev of evts.slice(0, 5)) {
    const detail = await fetchRaw(`https://hg-event-api-prod.sporty-tech.net/api/events/${ev.id}`, { headers: CB_HEADERS });
    const bts = detail.json?.eventBetTypes || [];
    const bt1x2 = bts.find(b => Number(b.betTypeId) === 10001);
    const its = bt1x2?.eventBetTypeItems || [];
    const home = its.find(it => (it.shortName || '').trim() === '1');
    if (home) { pick = detail.json; items = { home }; break; }
  }
  if (!pick) return record('congobet', false, { err: 'no event with 1X2 items' });
  const body = JSON.stringify({
    totalOdds: Number(items.home.odds),
    eventBetTypeItemIds: [Number(items.home.id)],
    betCategory: 'SportsFixedOdds', betSystemType: 'Simple',
    drawGameSelections: [], manualOddsBoostIds: [], oddsBoostIds: [],
    maxPayout: 300, stakePerLine: [50], totalStake: 50,
    hasBetBuilderBetLines: false,
  });
  const r = await fetchRaw('https://hg-betting-api-prod.sporty-tech.net/api/betting/get-my-code', {
    method: 'POST', headers: { ...CB_HEADERS, 'Content-Type': 'application/json' }, body,
  });
  const code = r.json?.code;
  record('congobet', !!code, {
    code, status: r.status,
    match: `${pick.homeTeamName} vs ${pick.awayTeamName}`,
    selection: `1X2 "1" @ ${items.home.odds}`,
    url: code ? `https://congobet.net/betting/booking/${code}` : null,
    raw: code ? null : r.text.slice(0, 200),
  });
}

// ═══════════════════════════════════════════════════════════════
// 3) BETMOMO (SWARM WS, is_booking:true)
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
    ws.on('error', () => { clearTimeout(hard); finish({ err: 'ws error' }); });
    ws.on('open', () => {
      ws.send(JSON.stringify({ command: 'request_session', params: { site_id: 122, language: 'eng' }, rid: 's1' }));
    });
    ws.on('message', async (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.rid === 's1') {
        if (!m.data?.sid) { clearTimeout(hard); return finish({ err: 'no sid' }); }
        const now = Math.floor(Date.now() / 1000);
        const games = await send('get', {
          source: 'betting',
          what: {
            game: ['id', 'team1_name', 'team2_name', 'start_ts'],
            market: ['id', 'type', 'name'],
            event: ['id', 'price', 'type_1', 'type', 'name'],
          },
          where: {
            sport: { id: 1 },
            game: { start_ts: { '@gt': now + 3600, '@lt': now + 259200 }, is_live: 0 },
            market: { type: { '@in': ['P1XP2', 'MatchResult', 'WinnerMatch'] } },
          },
        });
        let pick = null;
        for (const s of Object.values(games?.data?.sport || {})) {
          for (const rg of Object.values(s.region || {})) {
            for (const c of Object.values(rg.competition || {})) {
              for (const g of Object.values(c.game || {})) {
                const markets = Object.values(g.market || {});
                for (const mk of markets) {
                  const evts = Object.values(mk.event || {});
                  const home = evts.find(e => {
                    const t = String(e.type_1 || e.type || e.name || '').toLowerCase();
                    return t === 'w1' || t === '1' || t === 'home' || (e.type_1 === '1');
                  });
                  if (home && Number(home.price) > 1.4 && Number(home.price) < 4) {
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
          if (pick) break;
        }
        if (!pick) {
          const sample = JSON.stringify(games?.data || {}).slice(0, 300);
          clearTimeout(hard);
          return finish({ err: `no match found (sample: ${sample})` });
        }
        const bookRes = await send('do', {
          command: 'place_coupon',
          params: {
            type: 1, source: 12, mode: 5, use_amount_only: 1,
            is_booking: true, each_way: [], amount: 0,
            events: [{ event_id: Number(pick.event.id), price: Number(pick.event.price) }],
          },
        }).catch(() => null);
        const data = bookRes?.data || {};
        const code = data.book_id || data.bookid || data.details?.bookid || data.book?.id;
        clearTimeout(hard);
        finish({
          code: code ? String(code) : null,
          status: bookRes?.code === 0 ? 200 : (bookRes?.code || 0),
          match: `${pick.game.team1_name} vs ${pick.game.team2_name}`,
          selection: `1X2 Home @ ${pick.event.price} (event_id=${pick.event.id})`,
          url: code ? `https://www.betmomo.com?bookingId${code}` : null,
          raw: code ? null : JSON.stringify(bookRes).slice(0, 300),
        });
      } else if (pending[m.rid]) { pending[m.rid](m); delete pending[m.rid]; }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// 4) BETPAWA (v4 protobuf list + v4 JSON detail + booking-number)
// ═══════════════════════════════════════════════════════════════
const BP_HDR_LIST = {
  Accept: 'application/x-protobuf', 'Accept-Language': 'fr-FR,fr;q=0.7',
  'x-pawa-brand': 'betpawa-congobrazzaville', 'x-pawa-language': 'fr',
  Referer: 'https://cg.betpawa.com/events?categoryId=2&marketId=1X2', Cookie: 'bp_country=CG',
};
const BP_HDR_EVENT = { ...BP_HDR_LIST, Accept: 'application/json, text/plain, */*' };
async function testBetpawa() {
  console.log('\n─── BETPAWA ───');
  const q = { queries: [{ query: { eventType: 'UPCOMING', categories: ['2'], zones: {}, hasOdds: true }, view: { marketTypes: ['3743'] }, skip: 0, take: 30 }] };
  const listUrl = `https://cg.betpawa.com/api/sportsbook/v4/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`;
  const list = await fetchRaw(listUrl, { headers: BP_HDR_LIST });
  if (list.status !== 200 || !list.buf) return record('betpawa', false, { status: list.status, err: 'list failed', raw: list.text.slice(0, 200) });
  // Extract IDs from protobuf
  const strings = [];
  let cur = '';
  for (const b of list.buf) {
    if (b >= 32 && b <= 126) cur += String.fromCharCode(b);
    else { if (cur.length > 2) strings.push(cur); cur = ''; }
  }
  const ids = [...new Set(strings.filter(s => /^\d{7,10}$/.test(s) && s !== '3743'))].slice(0, 10);
  if (!ids.length) return record('betpawa', false, { err: 'no ids extracted' });
  // Try each id until we find a valid 1X2 with priceId
  for (const id of ids) {
    const detail = await fetchRaw(`https://cg.betpawa.com/api/sportsbook/v4/events/${id}`, { headers: BP_HDR_EVENT });
    const ev = detail.json;
    if (!ev?.markets) continue;
    const market = ev.markets.find(m => String(m.marketType?.id) === '3743');
    const price = market?.row?.[0]?.prices?.find(p => String(p.name).trim() === '1');
    if (!price?.id) continue;
    // Try body variants
    const bodies = [
      { selections: [{ id: price.id, price: String(price.odds) }] },
      { selections: [{ id: price.id }] },
      { selections: [{ priceId: price.id, eventId: id, marketTypeId: '3743', price: String(price.odds) }] },
    ];
    for (const b of bodies) {
      const r = await fetchRaw('https://cg.betpawa.com/api/sportsbook/v3/booking-number', {
        method: 'POST',
        headers: { ...BP_HDR_EVENT, 'Content-Type': 'application/json', Origin: 'https://cg.betpawa.com' },
        body: JSON.stringify(b),
      });
      const code = r.json?.code || r.json?.bookingNumber || r.json?.bookingCode || r.json?.data?.code;
      if (code) return record('betpawa', true, {
        code, status: r.status,
        match: `${ev.name || 'event ' + id}`,
        selection: `1X2 "1" @ ${price.odds}`,
        url: `https://cg.betpawa.com/booking/${code}`,
      });
    }
    return record('betpawa', false, { err: 'all body variants failed', status: 400 });
  }
  record('betpawa', false, { err: 'no event with 1X2 priceId' });
}

// ═══════════════════════════════════════════════════════════════
// 5) YELLOWBET (stealth, placebetsport isBooking:true)
// ═══════════════════════════════════════════════════════════════
const YB_HDR = { brandid: '122', channelid: '4', language: 'fr', terminal: 'yellowbet.cg' };
async function testYellowbet() {
  console.log('\n─── YELLOWBET ───');
  const list = await stealthRaw('https://yellowbet.cg/services/evapi/event/GetEvents?skip=0&take=500&count=500', { headers: YB_HDR });
  if (list.status !== 200) return record('yellowbet', false, { status: list.status, err: 'CF blocked', raw: (list.text || '').slice(0, 200) });
  const events = Array.isArray(list.json?.data) ? list.json.data : [];
  const foot = events.filter(e => e.sid === 1 && !e.lv);
  if (!foot.length) return record('yellowbet', false, { err: `catalog vide (${events.length} evts total)` });
  for (const ev of foot.slice(0, 15)) {
    const det = await stealthRaw(`https://yellowbet.cg/services/evapi/event/GetEventDetails?id=${encodeURIComponent(ev.id)}`, { headers: YB_HDR });
    const bts = Array.isArray(det.json?.data?.bts) ? det.json.data.bts : [];
    const bt1x2 = bts.find(b => /1x2|match\s*result|full\s*time.*result|ft\s*1x2/i.test(b.n || ''));
    const odds = bt1x2?.odds || bt1x2?.oc || [];
    const home = odds.find(o => (o.n || o.name || '').trim() === '1' || (o.k || o.oddkey || '').trim() === '1');
    if (!home) continue;
    const oddKey = home.k || home.oddkey || '1';
    const key = `E${ev.id}B${bt1x2.id}O${oddKey}X`;
    const body = JSON.stringify({
      language: 'fr', acceptOddsChanges: true, isBooking: true,
      bonusIds: [], BetBuilderModel: { BetBuilderEvents: [] },
      rows: [{ amount: 0, selectionKeys: [key] }],
      selections: [{
        key, eventId: Number(ev.id), betTypeId: Number(bt1x2.id),
        betTypeName: bt1x2.n || 'FT 1X2', oddKey, oddName: oddKey,
        oddPrice: String(home.p || home.price || home.odd),
        gameTime: ev.d || ev.gt || new Date(Date.now() + 3_600_000).toISOString(),
        homeName: ev.h, awayName: ev.a,
        isLive: false, isVirtual: false, eventStatus: 0, betStatus: 0, order: 1,
      }],
      source: '', sourceRef: '', totalStake: 0,
    });
    const r = await stealthRaw('https://yellowbet.cg/services/clapi/api/Bet/placebetsport', {
      method: 'POST', headers: { ...YB_HDR, 'Content-Type': 'application/json' }, body,
    });
    const code = r.json?.code || r.json?.data?.code;
    return record('yellowbet', !!code, {
      code, status: r.status,
      match: `${ev.h} vs ${ev.a}`,
      selection: `1X2 "1" @ ${home.p || home.price || home.odd}`,
      url: code ? `https://yellowbet.cg/booking/${code}` : null,
      raw: code ? null : (r.text || '').slice(0, 250),
    });
  }
  record('yellowbet', false, { err: `${foot.length} foot mais 0 avec 1X2 details` });
}

// ═══════════════════════════════════════════════════════════════
// 6) 1XBET (via CF worker proxies + SaveCoupon)
// ═══════════════════════════════════════════════════════════════
const XBET_WORKERS = [
  'https://hidden-pine-7436.veolalex3.workers.dev',
  'https://billowing-sea-2d8e.alvecapital60.workers.dev',
];
async function xbetWorkerJson(path) {
  for (const w of XBET_WORKERS) {
    try {
      const r = await fetch(`${w}?url=${encodeURIComponent('https://1xbet.cg' + path)}`, { signal: AbortSignal.timeout(15_000) });
      if (r.ok) return await r.json();
    } catch { /* try next */ }
  }
  return null;
}
async function testOnexbet() {
  console.log('\n─── 1XBET ───');
  const line = await xbetWorkerJson('/LineFeed/Get1x2_VZip?sports=1&count=50&lng=fr&mode=4&country=93&partner=192');
  const evts = line?.Value || [];
  const pick = evts.find(e => e.E > 1.4 && e.E < 4 && e.O1 && e.O2 && e.CI);
  if (!pick) return record('1xbet', false, { err: `${evts.length} evts, aucun valide (workers reachable=${!!line})` });
  const body = JSON.stringify({
    Events: [{ GameId: pick.CI, Type: 1, Coef: pick.E, Param: 0, Kind: 1, PlayerId: 0 }],
    partner: 192, Summ: '100', Lng: 'fr',
  });
  // SaveCoupon direct (worker si direct 203)
  const r = await fetchRaw('https://1xbet.cg/service-api/LiveBet/Open/SaveCoupon', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://1xbet.cg', Referer: 'https://1xbet.cg/fr/line/',
    },
    body,
  });
  const code = r.json?.Value;
  const success = r.json?.Success !== false && !!code;
  record('1xbet', success, {
    code, status: r.status,
    match: `${pick.O1} vs ${pick.O2}`,
    selection: `1X2 "1" @ ${pick.E} (GameId=${pick.CI})`,
    url: code ? `https://1xbet.cg/fr/list/coupon/${code}` : null,
    raw: code ? null : r.text.slice(0, 250),
  });
}

// ═══════════════════════════════════════════════════════════════
// 7) 1WIN (WebSocket push-server-v2 + shared-bets/create)
// ═══════════════════════════════════════════════════════════════
async function fetchOneWinOdds(matchId) {
  return new Promise((resolve) => {
    const url = 'wss://api-gateway.top-parser.com/push-server-v2/?Language=en-001&externalPartnerId=44ba10e5-7df2-47ab-a44d-dc93803c7a6e&EIO=4&transport=websocket';
    const ws = new WebSocket(url);
    let done = false; let started = false; let last = Date.now();
    const finish = (v) => { if (done) return; done = true; try { ws.close(); } catch { /* ignore */ } resolve(v); };
    const hard = setTimeout(() => finish(null), 20_000);
    let watch;
    ws.on('error', () => finish(null));
    ws.on('message', (raw) => {
      const m = raw.toString();
      if (m.startsWith('0')) { ws.send('40'); return; }
      if (m.startsWith('40')) {
        ws.send('42' + JSON.stringify(['subscribe', { messageType: 'subscribe-match-odds', data: { matchIds: [matchId], isBaseOddsGroups: false } }]));
        watch = setInterval(() => { if (started && Date.now() - last > 5000) { clearInterval(watch); clearTimeout(hard); finish(oddsGroups); } }, 500);
        return;
      }
      if (m === '2') { ws.send('3'); return; }
      if (m.startsWith('42')) {
        try {
          const p = JSON.parse(m.slice(2));
          const b = p[1];
          if (b?.data?.oddsGroups) {
            for (const g of b.data.oddsGroups) if (g.name && g.oddsList?.length) oddsGroups[g.name] = g.oddsList;
            started = true; last = Date.now();
          }
        } catch { /* ignore */ }
      }
    });
    const oddsGroups = {};
  });
}
async function testOnewin() {
  console.log('\n─── 1WIN ───');
  // Fetch list of prematch matches via 1win.ng or REST
  const list = await fetchRaw('https://1win.ng/api/v1/bets/prematch/matches?sportId=18&limit=20', {
    headers: { Origin: 'https://1win.ng', Referer: 'https://1win.ng/' },
  });
  const matches = list.json?.matches || list.json?.data || list.json?.items || [];
  const first = Array.isArray(matches) ? matches.find(m => m.id) : null;
  if (!first) return record('1win', false, { err: 'no matches from REST', status: list.status, raw: list.text.slice(0, 200) });
  const groups = await fetchOneWinOdds(first.id);
  if (!groups) return record('1win', false, { err: 'WS timeout', status: 0 });
  // Find Winner group, outcome "1"
  let oddId = null; let price = null;
  for (const [gname, olist] of Object.entries(groups)) {
    if (!/winner|1x2|result/i.test(gname)) continue;
    for (const o of olist) {
      if (String(o.outcome) === '1' && o.status === 1 && Number(o.cf) > 1.4 && Number(o.cf) < 4) {
        oddId = o.id; price = Number(o.cf); break;
      }
    }
    if (oddId) break;
  }
  if (!oddId) return record('1win', false, { err: `no valid oddId (groups: ${Object.keys(groups).slice(0, 5).join(',')})` });
  const body = JSON.stringify({
    coupons: [{ oddId: Number(oddId) }],
    currencyCode: 'USD', l: 'en', p: 'DesktopSite',
  });
  const r = await fetchRaw('https://api-gateway.top-parser.com/shared-bets/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://1win.ng', Referer: 'https://1win.ng/',
      externalPartnerId: '44ba10e5-7df2-47ab-a44d-dc93803c7a6e',
    },
    body,
  });
  const code = r.json?.result?.code || r.json?.code;
  record('1win', !!code, {
    code, status: r.status,
    match: `${first.team1?.name || first.homeName || '?'} vs ${first.team2?.name || first.awayName || '?'}`,
    selection: `Winner "1" @ ${price} (oddId=${oddId})`,
    url: code ? `https://1win.ng/betting/shared/${code}` : null,
    raw: code ? null : r.text.slice(0, 250),
  });
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
console.log('▶ PROBE COUPON CODES v2 — reelle generation via endpoints prod\n');
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
  if (r.match) console.log(`     ${r.match}${r.selection ? ' | ' + r.selection : ''}`);
  if (r.url) console.log(`     ${r.url}`);
}
console.log('\n═══ FIN ═══');
