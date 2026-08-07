#!/usr/bin/env node
// PROBE COUPON CODES v3 — corrections basees sur payloads REELS user
// (F12 verifies : SportyBet L3FRZR, BetPawa 65FNKJA, CongoBet 504126,
//  BetMomo bookingId 1138687, YellowBet B199971).
// Aucun endpoint ne demande d'auth utilisateur : ce sont des "booking codes"
// (reservation sans depot) — endpoints publics.
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
        browsers: [{ name: 'chrome', minVersion: 120 }], devices: ['desktop'],
        locales: ['fr-FR'], operatingSystems: ['linux'],
      },
      timeout: { request: opts.timeout || 20_000 }, retry: { limit: 0 }, throwHttpErrors: false,
    });
    let json = null;
    try { json = JSON.parse(res.body); } catch { /* ignore */ }
    return { status: res.statusCode, text: res.body, json };
  } catch (e) { return { status: 0, err: e.message, text: '', json: null }; }
}
const record = (book, ok, info) => {
  results[book] = { ok, ...info };
  const icon = ok ? '✅' : '⚠️';
  const code = info.code ? `CODE=${info.code}` : `HTTP ${info.status || '?'} ${info.err || ''}`;
  const suffix = info.match ? ` | ${info.match} | ${info.selection}` : '';
  console.log(`  ${icon} ${book.toUpperCase().padEnd(11)} ${code}${suffix}`);
  if (info.raw) console.log(`     raw: ${String(info.raw).slice(0, 300)}`);
  if (info.url) console.log(`     url: ${info.url}`);
};

// ═══════════════════════════════════════════════════════════════
// 1) SPORTYBET — payload EXACT confirme user : [{eventId, marketId, outcomeId}]
// ═══════════════════════════════════════════════════════════════
const SB_HDR = {
  Accept: '*/*', 'Accept-Language': 'en',
  Referer: 'https://www.sportybet.com/ng/sport/football/today',
  Origin: 'https://www.sportybet.com',
  clientid: 'web', operid: '2', platform: 'web',
};
async function testSportybet() {
  console.log('\n─── SPORTYBET ───');
  const list = await fetchRaw(
    'https://www.sportybet.com/api/ng/factsCenter/pcUpcomingEvents?sportId=sr:sport:1' +
    '&marketId=1,18,10,29,11,26,36,14,60100&pageNum=1&option=1&_t=' + Date.now(),
    { headers: SB_HDR }
  );
  const events = list.json?.data?.tournaments?.flatMap(t => t.events || []) || [];
  const now = Date.now();
  const pick = events.find(e => {
    if (e.estimateStartTime && e.estimateStartTime < now + 3_600_000) return false;
    const m = e.markets?.find(mk => String(mk.id) === '1');
    const home = m?.outcomes?.find(o => String(o.desc).toLowerCase() === 'home');
    return home && Number(home.odds) > 1.4 && Number(home.odds) < 4;
  });
  if (!pick) return record('sportybet', false, { err: 'no valid event' });
  const market = pick.markets.find(m => String(m.id) === '1');
  const home = market.outcomes.find(o => String(o.desc).toLowerCase() === 'home');
  // Payload exact confirme user : simple [{eventId, marketId, outcomeId}]
  const body = JSON.stringify([{ eventId: pick.eventId, marketId: '1', outcomeId: String(home.id) }]);
  const r = await fetchRaw('https://www.sportybet.com/api/ng/orders/share', {
    method: 'POST', headers: { ...SB_HDR, 'Content-Type': 'application/json' }, body,
  });
  const code = r.json?.data?.shareCode;
  record('sportybet', !!code, {
    code, status: r.status,
    match: `${pick.homeTeamName} vs ${pick.awayTeamName}`,
    selection: `1X2 Home @ ${home.odds}`,
    url: code ? `https://sportybet.com/ng/?shareCode=${code}` : null,
    raw: code ? null : r.text.slice(0, 250),
  });
}

// ═══════════════════════════════════════════════════════════════
// 2) CONGOBET — fix : 1 seul eventCategoryIds a la fois
// ═══════════════════════════════════════════════════════════════
const CB_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'fr-FR,fr;q=0.9',
  origin: 'https://www.congobet.net',
  referer: 'https://www.congobet.net/sports',
};
async function testCongobet() {
  console.log('\n─── CONGOBET ───');
  const cats = await fetchRaw('https://hg-event-api-prod.sporty-tech.net/api/eventCategories/101?l=fr', { headers: CB_HEADERS });
  const leaves = [];
  const walk = (n) => {
    const s = n.subCategories || [];
    if (!s.length) { if ((n.eventsCount || 0) > 0) leaves.push(n.id); }
    else s.forEach(walk);
  };
  (cats.json || []).forEach(walk);
  if (!leaves.length) return record('congobet', false, { err: 'no leaf cats' });
  // 1 catId a la fois (fix : virgules non supportees)
  let pick = null; let home = null;
  for (const catId of leaves.slice(0, 8)) {
    const url = `https://hg-event-api-prod.sporty-tech.net/api/events?eventCategoryIds=${catId}&betTypeId=10001&l=fr&skip=0&take=10`;
    const evList = await fetchRaw(url, { headers: CB_HEADERS });
    const evts = Array.isArray(evList.json) ? evList.json : (evList.json?.items || []);
    for (const ev of evts.slice(0, 3)) {
      const detail = await fetchRaw(`https://hg-event-api-prod.sporty-tech.net/api/events/${ev.id}`, { headers: CB_HEADERS });
      const bt1x2 = detail.json?.eventBetTypes?.find(b => Number(b.betTypeId) === 10001);
      const h = bt1x2?.eventBetTypeItems?.find(it => (it.shortName || '').trim() === '1');
      if (h && Number(h.odds) > 1.4 && Number(h.odds) < 4) { pick = detail.json; home = h; break; }
    }
    if (pick) break;
  }
  if (!pick) return record('congobet', false, { err: 'no event with valid 1X2 home' });
  const body = JSON.stringify({
    totalOdds: Number(home.odds),
    eventBetTypeItemIds: [Number(home.id)],
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
    selection: `1X2 "1" @ ${home.odds}`,
    url: code ? `https://congobet.net/betting/booking/${code}` : null,
    raw: code ? null : r.text.slice(0, 250),
  });
}

// ═══════════════════════════════════════════════════════════════
// 3) BETMOMO — endpoint HTTP direct : winners.bcapps.org/image-creator/share-booking/
// Fetch un match via SWARM d'abord (pas de REST public), puis share-booking
// ═══════════════════════════════════════════════════════════════
async function findBetmomoMatch() {
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://eu-swarm-newm.betconstruct.com/');
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { ws.close(); } catch { /* ignore */ } resolve(v); };
    const hard = setTimeout(() => finish(null), 15_000);
    const pending = {}; let rid = 0;
    const send = (cmd, params) => new Promise((res) => {
      const r = 'r' + (++rid); pending[r] = res;
      ws.send(JSON.stringify({ command: cmd, params, rid: r }));
    });
    ws.on('error', () => finish(null));
    ws.on('open', () => ws.send(JSON.stringify({ command: 'request_session', params: { site_id: 122, language: 'eng' }, rid: 's1' })));
    ws.on('message', async (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.rid === 's1') {
        if (!m.data?.sid) { clearTimeout(hard); return finish(null); }
        const now = Math.floor(Date.now() / 1000);
        const games = await send('get', {
          source: 'betting',
          what: {
            game: ['id', 'team1_name', 'team2_name'],
            market: ['id', 'type'], event: ['id', 'price', 'type_1', 'type'],
          },
          where: {
            sport: { id: 1 },
            game: { start_ts: { '@gt': now + 3600, '@lt': now + 172800 }, is_live: 0 },
            market: { type: 'P1XP2' },
          },
        });
        let pick = null;
        for (const s of Object.values(games?.data?.sport || {})) {
          for (const rg of Object.values(s.region || {})) {
            for (const c of Object.values(rg.competition || {})) {
              for (const g of Object.values(c.game || {})) {
                for (const mk of Object.values(g.market || {})) {
                  // Parcourir TOUS les events du market (pas juste 1er)
                  for (const ev of Object.values(mk.event || {})) {
                    const t = String(ev.type_1 || ev.type || '').toUpperCase();
                    if ((t === 'W1' || t === '1' || t === 'HOME' || t === 'P1') &&
                        Number(ev.price) > 1.4 && Number(ev.price) < 4) {
                      pick = { game: g, event: ev }; break;
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
          if (pick) break;
        }
        clearTimeout(hard); finish(pick);
      } else if (pending[m.rid]) { pending[m.rid](m); delete pending[m.rid]; }
    });
  });
}
async function testBetmomo() {
  console.log('\n─── BETMOMO ───');
  const pick = await findBetmomoMatch();
  if (!pick) return record('betmomo', false, { err: 'no match via SWARM' });
  // Endpoint HTTP image-creator/share-booking (user F12)
  const body = JSON.stringify({
    siteId: 211,
    lang: 'fra',
    events: [{
      eventId: Number(pick.event.id),
      gameId: Number(pick.game.id),
      price: Number(pick.event.price),
    }],
    betType: 1,
  });
  const r = await fetchRaw('https://winners.bcapps.org/image-creator/share-booking/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://www.betmomo.com', Referer: 'https://www.betmomo.com/',
    },
    body,
  });
  const bookId = r.json?.share?.bookId || r.json?.bookId;
  const link = r.json?.share?.bookingLink;
  record('betmomo', !!bookId, {
    code: bookId ? String(bookId) : null, status: r.status,
    match: `${pick.game.team1_name} vs ${pick.game.team2_name}`,
    selection: `1X2 Home @ ${pick.event.price}`,
    url: link || (bookId ? `https://www.betmomo.com?bookingId${bookId}` : null),
    raw: bookId ? null : r.text.slice(0, 300),
  });
}

// ═══════════════════════════════════════════════════════════════
// 4) BETPAWA — v4 protobuf + booking-number
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
  if (list.status !== 200) return record('betpawa', false, { status: list.status, err: 'list failed' });
  const strings = [];
  let cur = '';
  for (const b of list.buf) {
    if (b >= 32 && b <= 126) cur += String.fromCharCode(b);
    else { if (cur.length > 2) strings.push(cur); cur = ''; }
  }
  const ids = [...new Set(strings.filter(s => /^\d{7,10}$/.test(s) && s !== '3743'))].slice(0, 15);
  if (!ids.length) return record('betpawa', false, { err: 'no ids extracted' });
  for (const id of ids) {
    const detail = await fetchRaw(`https://cg.betpawa.com/api/sportsbook/v4/events/${id}`, { headers: BP_HDR_EVENT });
    const ev = detail.json;
    if (!ev?.markets) continue;
    const market = ev.markets.find(m => String(m.marketType?.id) === '3743');
    const price = market?.row?.[0]?.prices?.find(p => String(p.name).trim() === '1' || /home|dom/i.test(p.name || ''));
    if (!price?.id) continue;
    // Body variants exhaustifs (aucun format documenté user pour BP)
    const bodies = [
      { selections: [{ id: price.id }] },
      { selections: [{ id: price.id, price: String(price.odds) }] },
      { selections: [{ priceId: price.id, price: String(price.odds) }] },
      { selections: [{ priceId: price.id }] },
      { selections: [{ eventId: id, marketId: '3743', priceId: price.id, price: String(price.odds) }] },
      [{ id: price.id }],
      [{ priceId: price.id, price: String(price.odds) }],
    ];
    for (const b of bodies) {
      const r = await fetchRaw('https://cg.betpawa.com/api/sportsbook/v3/booking-number', {
        method: 'POST',
        headers: {
          ...BP_HDR_EVENT, 'Content-Type': 'application/json', Origin: 'https://cg.betpawa.com',
          'x-pawa-user-timezone': 'Africa/Brazzaville',
        },
        body: JSON.stringify(b),
      });
      const code = r.json?.code || r.json?.bookingNumber || r.json?.bookingCode;
      if (code) return record('betpawa', true, {
        code, status: r.status,
        match: `${ev.name || 'event ' + id}`,
        selection: `1X2 "1" @ ${price.odds}`,
        url: `https://cg.betpawa.com/booking/${code}`,
      });
    }
    // Log body erreur pour debug
    return record('betpawa', false, { err: 'all body variants 400', status: 400 });
  }
  record('betpawa', false, { err: 'no event with 1X2 price.id' });
}

// ═══════════════════════════════════════════════════════════════
// 5) YELLOWBET — payload EXACT user (isBooking:true + key E{eventId}B{betTypeId}O{oddKey}X)
// Fix filter : chercher directement bts avec betTypeName "FT 1X2"
// ═══════════════════════════════════════════════════════════════
const YB_HDR = { brandid: '122', channelid: '4', language: 'fr', terminal: 'yellowbet.cg' };
async function testYellowbet() {
  console.log('\n─── YELLOWBET ───');
  const list = await stealthRaw('https://yellowbet.cg/services/evapi/event/GetEvents?skip=0&take=500&count=500', { headers: YB_HDR });
  if (list.status !== 200) return record('yellowbet', false, { status: list.status, err: 'CF blocked' });
  const events = Array.isArray(list.json?.data) ? list.json.data : [];
  if (!events.length) return record('yellowbet', false, { err: 'catalog vide' });
  // Ne pas filtrer par sid=1 (peut varier). Chercher plutot les evts avec bts contenant "1X2"
  // via GetEventDetails direct — mais trop long pour 500. Filtrer par !lv (pas live)
  const candidates = events.filter(e => !e.lv);
  for (const ev of candidates.slice(0, 20)) {
    const det = await stealthRaw(`https://yellowbet.cg/services/evapi/event/GetEventDetails?id=${encodeURIComponent(ev.id)}`, { headers: YB_HDR });
    const bts = Array.isArray(det.json?.data?.bts) ? det.json.data.bts : [];
    // Chercher betTypeName contenant "1X2" ou "FT 1X2"
    const bt1x2 = bts.find(b => /1x2|match\s*result|full\s*time.*result/i.test(b.n || b.name || ''));
    const odds = bt1x2?.odds || bt1x2?.oc || [];
    if (!odds.length) continue;
    // Prendre l'outcome "1" (Home)
    const home = odds.find(o => (o.k || o.oddkey || o.n || '').trim() === '1');
    if (!home) continue;
    const oddKey = home.k || home.oddkey || '1';
    const key = `E${ev.id}B${bt1x2.id}O${oddKey}X`;
    // Payload EXACT user
    const body = JSON.stringify({
      language: 'fr', acceptOddsChanges: true, isBooking: true,
      bonusIds: [], BetBuilderModel: { BetBuilderEvents: [] },
      rows: [{ amount: 0, selectionKeys: [key] }],
      selections: [{
        key, eventId: Number(ev.id), betTypeId: Number(bt1x2.id),
        betTypeName: bt1x2.n || 'FT 1X2', oddKey, oddName: oddKey, oddDisplayName: oddKey,
        oddPrice: String(home.p || home.price || home.odd),
        oldOddPrice: null,
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
      raw: code ? null : (r.text || '').slice(0, 300),
    });
  }
  record('yellowbet', false, { err: `${candidates.length} candidats mais 0 avec 1X2 home` });
}

// ═══════════════════════════════════════════════════════════════
// 6) 1XBET — direct + fallback CORS proxies publics
// ═══════════════════════════════════════════════════════════════
const PROXIES = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];
async function xbetGet(path) {
  const url = 'https://1xbet.cg' + path;
  // Direct first
  const direct = await fetchRaw(url, { headers: { Referer: 'https://1xbet.cg/', Accept: 'application/json' } });
  if (direct.json?.Value) return direct.json;
  // Proxy fallback
  for (const p of PROXIES) {
    const r = await fetchRaw(p(url), { timeout: 15_000 });
    if (r.json?.Value) return r.json;
  }
  return null;
}
async function testOnexbet() {
  console.log('\n─── 1XBET ───');
  const line = await xbetGet('/LineFeed/Get1x2_VZip?sports=1&count=50&lng=fr&mode=4&country=93&partner=192');
  const evts = line?.Value || [];
  const pick = evts.find(e => e.E > 1.4 && e.E < 4 && e.O1 && e.O2 && (e.CI || e.I));
  if (!pick) return record('1xbet', false, { err: `${evts.length} evts, aucun valide` });
  const gameId = pick.CI || pick.I;
  const body = JSON.stringify({
    Events: [{ GameId: gameId, Type: 1, Coef: pick.E, Param: 0, Kind: 1, PlayerId: 0 }],
    partner: 192, Summ: '100', Lng: 'fr',
  });
  // Try direct
  let r = await fetchRaw('https://1xbet.cg/service-api/LiveBet/Open/SaveCoupon', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*',
      Origin: 'https://1xbet.cg', Referer: 'https://1xbet.cg/fr/line/',
    },
    body,
  });
  if (!r.json?.Value) {
    // Fallback via proxy
    for (const p of PROXIES) {
      r = await fetchRaw(p('https://1xbet.cg/service-api/LiveBet/Open/SaveCoupon'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (r.json?.Value) break;
    }
  }
  const code = r.json?.Value;
  record('1xbet', !!code && r.json?.Success !== false, {
    code, status: r.status,
    match: `${pick.O1} vs ${pick.O2}`,
    selection: `1X2 "1" @ ${pick.E} (GameId=${gameId})`,
    url: code ? `https://1xbet.cg/fr/list/coupon/${code}` : null,
    raw: code ? null : r.text.slice(0, 250),
  });
}

// ═══════════════════════════════════════════════════════════════
// 7) 1WIN — WS push-server-v2 pour list + odds + shared-bets/create
// ═══════════════════════════════════════════════════════════════
async function fetchOnewinMatches() {
  return new Promise((resolve) => {
    const url = 'wss://api-gateway.top-parser.com/push-server-v2/?Language=en-001&externalPartnerId=44ba10e5-7df2-47ab-a44d-dc93803c7a6e&EIO=4&transport=websocket';
    const ws = new WebSocket(url);
    let done = false; let last = Date.now();
    const finish = (v) => { if (done) return; done = true; try { ws.close(); } catch { /* ignore */ } resolve(v); };
    const hard = setTimeout(() => finish(null), 20_000);
    const matches = new Map();
    ws.on('error', () => finish(null));
    ws.on('message', (raw) => {
      const m = raw.toString();
      if (m.startsWith('0')) { ws.send('40'); return; }
      if (m.startsWith('40')) {
        ws.send('42' + JSON.stringify(['subscribe', { messageType: 'subscribe-sport-matches', data: { sportId: 18, isLive: false } }]));
        return;
      }
      if (m === '2') { ws.send('3'); return; }
      if (m.startsWith('42')) {
        try {
          const p = JSON.parse(m.slice(2));
          const b = p[1];
          if (b?.messageType?.includes('matches') && Array.isArray(b.data?.matches)) {
            for (const mat of b.data.matches) matches.set(mat.id, mat);
            last = Date.now();
            if (matches.size > 3) {
              clearTimeout(hard);
              setTimeout(() => finish([...matches.values()]), 2000);
            }
          }
        } catch { /* ignore */ }
      }
    });
  });
}
async function fetchOnewinOdds(matchId) {
  return new Promise((resolve) => {
    const url = 'wss://api-gateway.top-parser.com/push-server-v2/?Language=en-001&externalPartnerId=44ba10e5-7df2-47ab-a44d-dc93803c7a6e&EIO=4&transport=websocket';
    const ws = new WebSocket(url);
    let done = false; let last = Date.now();
    const finish = (v) => { if (done) return; done = true; try { ws.close(); } catch { /* ignore */ } resolve(v); };
    const hard = setTimeout(() => finish(null), 15_000);
    const oddsGroups = {};
    ws.on('error', () => finish(null));
    ws.on('message', (raw) => {
      const m = raw.toString();
      if (m.startsWith('0')) { ws.send('40'); return; }
      if (m.startsWith('40')) {
        ws.send('42' + JSON.stringify(['subscribe', { messageType: 'subscribe-match-odds', data: { matchIds: [matchId], isBaseOddsGroups: false } }]));
        return;
      }
      if (m === '2') { ws.send('3'); return; }
      if (m.startsWith('42')) {
        try {
          const p = JSON.parse(m.slice(2));
          const b = p[1];
          if (b?.data?.oddsGroups) {
            for (const g of b.data.oddsGroups) if (g.name && g.oddsList?.length) oddsGroups[g.name] = g.oddsList;
            last = Date.now();
            if (Object.keys(oddsGroups).length > 0) {
              clearTimeout(hard);
              setTimeout(() => finish(oddsGroups), 2000);
            }
          }
        } catch { /* ignore */ }
      }
    });
  });
}
async function testOnewin() {
  console.log('\n─── 1WIN ───');
  const matches = await fetchOnewinMatches();
  if (!matches?.length) return record('1win', false, { err: 'no matches from WS' });
  const first = matches[0];
  const groups = await fetchOnewinOdds(first.id);
  if (!groups || !Object.keys(groups).length) return record('1win', false, { err: 'no odds from WS' });
  let oddId = null; let price = null;
  for (const [gname, olist] of Object.entries(groups)) {
    if (!/winner|1x2|result|исход/i.test(gname)) continue;
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
console.log('▶ PROBE COUPON CODES v3 — payloads REELS confirmes user\n');
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
