#!/usr/bin/env node
// PROBE COUPON CODES v5 — payloads EXACTS F12 user
// BetPawa: {selections:{selections:[{type:COMBO,selections:[NUM_IDS]}]}}
// SportyBet: cookies session + sporty-referer
// 1win: {coupons:[{oddId:STRING, matchId:NUM}]}
// YellowBet: oddPrice number + hasTCO + sourceModule
import WebSocket from 'ws';
import { gotScraping } from 'got-scraping';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36';
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
// 1) SPORTYBET — headers EXACTS F12 user (avec cookies session + sporty-referer)
// ═══════════════════════════════════════════════════════════════
const SB_HDR = {
  Accept: '*/*', 'Accept-Language': 'en',
  Referer: 'https://www.sportybet.com/ng/',
  Origin: 'https://www.sportybet.com',
  clientid: 'web', operid: '2', platform: 'web',
  'sporty-referer': 'utm_source=https://www.google.com/',
  Cookie: 'locale=en; device-id=1918057d-2b3a-4f8a-90c3-083dd139d39b; sb_country=ng',
};
async function testSportybet() {
  console.log('\n─── SPORTYBET ───');
  const list = await fetchRaw(
    'https://www.sportybet.com/api/ng/factsCenter/pcUpcomingEvents?sportId=sr:sport:1' +
    '&marketId=1&pageNum=1&option=1&_t=' + Date.now(),
    { headers: SB_HDR }
  );
  const events = list.json?.data?.tournaments?.flatMap(t => t.events || []) || [];
  // Prendre un match avec cote raisonnable (1.5-3.0) pour éviter rejets bookmaker
  const pick = events.find(e => {
    const m = e.markets?.find(mk => String(mk.id) === '1');
    const home = m?.outcomes?.find(o => String(o.desc).toLowerCase() === 'home');
    return home && Number(home.odds) > 1.5 && Number(home.odds) < 3.5;
  }) || events.find(e => e.markets?.find(mk => String(mk.id) === '1')?.outcomes?.length);
  if (!pick) return record('sportybet', false, { err: 'no event' });
  const market = pick.markets.find(m => String(m.id) === '1');
  const home = market.outcomes.find(o => String(o.desc).toLowerCase() === 'home') || market.outcomes[0];
  const body = JSON.stringify([{ eventId: pick.eventId, marketId: '1', outcomeId: String(home.id) }]);
  const r = await fetchRaw('https://www.sportybet.com/api/ng/orders/share', {
    method: 'POST', headers: { ...SB_HDR, 'Content-Type': 'application/json;charset=UTF-8' }, body,
  });
  const code = r.json?.data?.shareCode;
  record('sportybet', !!code, {
    code, status: r.status,
    match: `${pick.homeTeamName} vs ${pick.awayTeamName}`,
    selection: `${home.desc} @ ${home.odds}`,
    url: code ? `https://sportybet.com/ng/?shareCode=${code}` : null,
    raw: code ? null : r.text.slice(0, 300),
  });
}

// ═══════════════════════════════════════════════════════════════
// 2) CONGOBET — deja marche
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
  if (!pick) return record('congobet', false, { err: 'no event' });
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
  });
}

// ═══════════════════════════════════════════════════════════════
// 3) 1XBET — via megapari.africa, GetGameZip pour cote reelle
// ═══════════════════════════════════════════════════════════════
const MP_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'fr-FR,fr;q=0.9',
  'content-type': 'application/json',
  origin: 'https://megapari.africa',
  referer: 'https://megapari.africa/fr/line',
  'x-requested-with': 'XMLHttpRequest',
  'x-app-n': '__BETTING_APP__',
  'x-svc-source': '__BETTING_APP__',
};
async function testOnexbet() {
  console.log('\n─── 1XBET (via megapari.africa) ───');
  const line = await fetchRaw(
    'https://megapari.africa/service-api/LineFeed/Get1x2_VZip?sports=1&count=50&lng=fr&mode=4&country=93&partner=192',
    { headers: MP_HEADERS }
  );
  const evts = line?.json?.Value || [];
  // Get1x2_VZip retourne matchs SANS cotes → utiliser GetGameZip pour cote fresh
  const evtWithId = evts.find(e => e.CI || e.I);
  if (!evtWithId) return record('1xbet', false, { err: `${evts.length} evts, aucun avec ID` });
  const gameId = evtWithId.CI || evtWithId.I;
  // GetGameZip pour recuperer les cotes 1X2
  const gameZip = await fetchRaw(
    `https://megapari.africa/service-api/LineFeed/GetGameZip?id=${gameId}&lng=fr&isSubGames=true&GroupEvents=true&countevents=500&grMode=4&country=93&marketType=1&isNewBuilder=true`,
    { headers: MP_HEADERS }
  );
  let cote = null;
  const ge = gameZip.json?.Value?.GE || [];
  for (const g of ge) {
    if (!g?.E) continue;
    for (const sub of g.E) {
      for (const it of (Array.isArray(sub) ? sub : [sub])) {
        if (it?.T === 1 && it?.C) { cote = parseFloat(it.C); break; }
      }
      if (cote) break;
    }
    if (cote) break;
  }
  if (!cote) return record('1xbet', false, { err: `pas de cote T=1 pour game ${gameId}` });
  const body = JSON.stringify({
    notWait: true, CheckCf: 1, partner: 192, Summ: 500,
    Events: [{
      GameId: gameId, Type: 1, Coef: cote, Param: 0,
      PV: null, PlayerId: 0, Kind: 3,
      InstrumentId: 0, Seconds: 0, Price: 0, Expired: 0,
      PlayersDuel: { Team1Ids: null, Team2Ids: null },
    }],
    Vid: 1, UserId: 0,
  });
  const r = await fetchRaw('https://megapari.africa/service-api/LiveBet/Open/SaveCoupon', {
    method: 'POST', headers: MP_HEADERS, body,
  });
  const code = r.json?.Value;
  const success = r.json?.Success !== false && !!code;
  record('1xbet', success, {
    code, status: r.status,
    match: `${evtWithId.O1 || '?'} vs ${evtWithId.O2 || '?'}`,
    selection: `1X2 "1" @ ${cote} (GameId=${gameId})`,
    url: code ? `https://megapari.africa/fr/list/coupon/${code}` : null,
    raw: code ? null : r.text.slice(0, 300),
  });
}

// ═══════════════════════════════════════════════════════════════
// 4) BETMOMO — SWARM query elargie
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
        // Query TRES elargie : tout foot upcoming avec markets
        const games = await send('get', {
          source: 'betting',
          what: { game: ['id', 'team1_name', 'team2_name'], market: ['id', 'type'], event: ['id', 'price', 'type_1', 'type', 'name'] },
          where: {
            sport: { id: 1 },
            game: { start_ts: { '@gt': now + 1800 }, is_live: 0 },
          },
        });
        let pick = null;
        for (const s of Object.values(games?.data?.sport || {})) {
          for (const rg of Object.values(s.region || {})) {
            for (const c of Object.values(rg.competition || {})) {
              for (const g of Object.values(c.game || {})) {
                for (const mk of Object.values(g.market || {})) {
                  for (const ev of Object.values(mk.event || {})) {
                    if (Number(ev.price) > 1.4 && Number(ev.price) < 4) {
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
  if (!pick) return record('betmomo', false, { err: 'no match via SWARM (elargie)' });
  const body = JSON.stringify({
    siteId: 211, lang: 'fra',
    events: [{ eventId: Number(pick.event.id), gameId: Number(pick.game.id), price: Number(pick.event.price) }],
    betType: 1,
  });
  const r = await fetchRaw('https://winners.bcapps.org/image-creator/share-booking/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://www.betmomo.com', Referer: 'https://www.betmomo.com/' },
    body,
  });
  const bookId = r.json?.share?.bookId || r.json?.bookId;
  const link = r.json?.share?.bookingLink;
  record('betmomo', !!bookId, {
    code: bookId ? String(bookId) : null, status: r.status,
    match: `${pick.game.team1_name} vs ${pick.game.team2_name}`,
    selection: `1X2 @ ${pick.event.price}`,
    url: link || (bookId ? `https://www.betmomo.com?bookingId${bookId}` : null),
    raw: bookId ? null : r.text.slice(0, 300),
  });
}

// ═══════════════════════════════════════════════════════════════
// 5) BETPAWA — FORMAT EXACT F12 : {selections:{selections:[{type:COMBO, selections:[NUM_IDS]}]}}
// ═══════════════════════════════════════════════════════════════
const BP_HDR_LIST = {
  Accept: 'application/x-protobuf', 'Accept-Language': 'fr-FR,fr;q=0.7',
  'x-pawa-brand': 'betpawa-congobrazzaville', 'x-pawa-language': 'fr',
  Referer: 'https://cg.betpawa.com/events?categoryId=2&marketId=1X2', Cookie: 'bp_country=CG',
};
const BP_HDR_EVENT = { ...BP_HDR_LIST, Accept: 'application/json, text/plain, */*' };
async function testBetpawa() {
  console.log('\n─── BETPAWA ───');
  const q = { queries: [{ query: { eventType: 'UPCOMING', categories: ['2'], zones: {}, hasOdds: true }, view: { marketTypes: ['3743'] }, skip: 0, take: 20 }] };
  const listUrl = `https://cg.betpawa.com/api/sportsbook/v4/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`;
  const list = await fetchRaw(listUrl, { headers: BP_HDR_LIST });
  if (list.status !== 200) return record('betpawa', false, { status: list.status, err: 'list failed' });
  const strings = [];
  let cur = '';
  for (const b of list.buf) {
    if (b >= 32 && b <= 126) cur += String.fromCharCode(b);
    else { if (cur.length > 2) strings.push(cur); cur = ''; }
  }
  const ids = [...new Set(strings.filter(s => /^\d{7,10}$/.test(s) && s !== '3743'))].slice(0, 10);
  if (!ids.length) return record('betpawa', false, { err: 'no ids' });
  // Trouver un event valide avec price.id numerique
  for (const id of ids) {
    const detail = await fetchRaw(`https://cg.betpawa.com/api/sportsbook/v4/events/${id}`, { headers: BP_HDR_EVENT });
    const ev = detail.json;
    const market = ev?.markets?.find(m => String(m.marketType?.id) === '3743');
    const price = market?.row?.[0]?.prices?.find(p => String(p.name).trim() === '1');
    if (!price?.id) continue;
    // FORMAT EXACT F12 : {selections:{selections:[{type:"COMBO", selections:[NUM_ID]}]}}
    const body = JSON.stringify({
      selections: {
        selections: [{
          type: 'COMBO',
          selections: [Number(price.id)],
        }],
      },
    });
    const r = await fetchRaw('https://cg.betpawa.com/api/sportsbook/v3/booking-number', {
      method: 'POST',
      headers: {
        ...BP_HDR_EVENT, 'Content-Type': 'application/json',
        Origin: 'https://cg.betpawa.com', devicetype: 'web',
      },
      body,
    });
    const code = r.json?.code;
    if (code) return record('betpawa', true, {
      code, status: r.status,
      match: ev.name || `event ${id}`,
      selection: `1X2 "1" @ ${price.odds} (priceId=${price.id})`,
      url: `https://cg.betpawa.com/booking/${code}`,
    });
    // Log premier échec pour diag
    console.log(`     event ${id}: HTTP ${r.status}, body: ${r.text.slice(0, 150)}`);
  }
  record('betpawa', false, { err: 'all events failed' });
}

// ═══════════════════════════════════════════════════════════════
// 6) YELLOWBET — oddPrice number + hasTCO + sourceModule
// ═══════════════════════════════════════════════════════════════
const YB_HDR = { brandid: '122', channelid: '4', language: 'fr', terminal: 'yellowbet.cg' };
async function testYellowbet() {
  console.log('\n─── YELLOWBET ───');
  const list = await stealthRaw('https://yellowbet.cg/services/evapi/event/GetEvents?skip=0&take=500&count=500', { headers: YB_HDR });
  if (list.status !== 200) return record('yellowbet', false, { status: list.status, err: 'CF blocked' });
  const events = Array.isArray(list.json?.data) ? list.json.data : [];
  const candidates = events.filter(e => !e.lv);
  if (!candidates.length) return record('yellowbet', false, { err: 'catalog vide' });
  for (const ev of candidates.slice(0, 15)) {
    const det = await stealthRaw(`https://yellowbet.cg/services/evapi/event/GetEventDetails?id=${encodeURIComponent(ev.id)}`, { headers: YB_HDR });
    const bts = Array.isArray(det.json?.data?.bts) ? det.json.data.bts : [];
    // Chercher un bt avec 3 outcomes (probable 1X2) et name containing 1x2/result
    const bt1x2 = bts.find(b => /1x2|match\s*result|full\s*time|resultat|résultat/i.test((b.n || '').trim())
      && (b.odds || b.oc || []).length >= 2)
      || bts.find(b => (b.odds || b.oc || []).length === 3);
    if (!bt1x2) continue;
    const odds = bt1x2.odds || bt1x2.oc || [];
    const home = odds.find(o => (o.k || o.oddkey || '').trim() === '1' || (o.n || '').trim() === '1') || odds[0];
    if (!home) continue;
    const oddKey = home.k || home.oddkey || '1';
    const key = `E${ev.id}B${bt1x2.id}O${oddKey}`;
    // Payload EXACT F12 user
    const body = JSON.stringify({
      language: 'fr', acceptOddsChanges: true, isBooking: true,
      bonusIds: [], BetBuilderModel: { BetBuilderEvents: [] },
      rows: [{ amount: 0, selectionKeys: [key] }],
      selections: [{
        key, eventId: Number(ev.id), eventStatus: 0,
        homeName: ev.h, awayName: ev.a,
        betStatus: 0, betTypeId: Number(bt1x2.id),
        betTypeName: bt1x2.n || 'FT 1X2',
        gameTime: ev.d || ev.gt || new Date(Date.now() + 3_600_000).toISOString(),
        hasTCO: true,
        isLive: false, isVirtual: false,
        oddDisplayName: oddKey, oddKey, oddName: oddKey,
        oddPrice: Number(home.p || home.price || home.odd),
        oldOddPrice: null,
        order: 1,
        sourceModule: 'popular_event_carousel',
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
      selection: `${bt1x2.n} "${oddKey}" @ ${home.p || home.price || home.odd}`,
      url: code ? `https://yellowbet.cg/booking/${code}` : null,
      raw: code ? null : (r.text || '').slice(0, 350),
    });
  }
  record('yellowbet', false, { err: `${candidates.length} candidats, 0 avec bt 1X2` });
}

// ═══════════════════════════════════════════════════════════════
// 7) 1WIN — WS pour trouver oddId string + matchId
// Format oddId : "10:UNIQUEID:1" (10=Winner group, 1=Home outcome)
// ═══════════════════════════════════════════════════════════════
async function fetchOnewinOdds() {
  return new Promise((resolve) => {
    const url = 'wss://api-gateway.top-parser.com/push-server-v2/?Language=en-001&externalPartnerId=44ba10e5-7df2-47ab-a44d-dc93803c7a6e&EIO=4&transport=websocket';
    const ws = new WebSocket(url);
    let done = false; let subscribed = false; let last = Date.now();
    const finish = (v) => { if (done) return; done = true; try { ws.close(); } catch { /* ignore */ } resolve(v); };
    const hard = setTimeout(() => finish(null), 20_000);
    const foundOdds = [];
    ws.on('error', () => finish(null));
    ws.on('message', (raw) => {
      const m = raw.toString();
      if (m.startsWith('0')) { ws.send('40'); return; }
      if (m.startsWith('40')) {
        // Subscribe to sport 18 (football) matches with odds
        ws.send('42' + JSON.stringify(['subscribe', { messageType: 'subscribe-sport-matches', data: { sportId: 18, isLive: false, isBaseOddsGroups: true } }]));
        subscribed = true;
        return;
      }
      if (m === '2') { ws.send('3'); return; }
      if (m.startsWith('42')) {
        try {
          const p = JSON.parse(m.slice(2));
          const b = p[1];
          const data = b?.data;
          // Peut être matches: [...] avec chacun ses oddsGroups
          const items = data?.matches || data?.events || (Array.isArray(data) ? data : null);
          if (Array.isArray(items)) {
            for (const it of items) {
              const gs = it.oddsGroups || it.groups || [];
              for (const g of gs) {
                for (const o of (g.oddsList || g.odds || [])) {
                  if (String(o.outcome) === '1' && Number(o.cf) > 1.4 && Number(o.cf) < 3.5) {
                    foundOdds.push({
                      matchId: it.id,
                      oddId: o.id,
                      cf: Number(o.cf),
                      team1: it.team1?.name || it.homeName || it.team1Name,
                      team2: it.team2?.name || it.awayName || it.team2Name,
                    });
                  }
                }
              }
            }
            last = Date.now();
            if (foundOdds.length > 0) {
              clearTimeout(hard);
              setTimeout(() => finish(foundOdds), 2000);
            }
          }
        } catch { /* ignore */ }
      }
    });
  });
}
async function testOnewin() {
  console.log('\n─── 1WIN ───');
  const odds = await fetchOnewinOdds();
  if (!odds?.length) return record('1win', false, { err: 'no odds from WS' });
  const pick = odds[0];
  // FORMAT EXACT F12 : {coupons:[{oddId:"10:XXX:1", matchId:NUM}]}
  const body = JSON.stringify({
    coupons: [{ oddId: String(pick.oddId), matchId: Number(pick.matchId) }],
  });
  const r = await fetchRaw('https://api-gateway.top-parser.com/shared-bets/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://1win.ng', Referer: 'https://1win.ng/',
    },
    body,
  });
  const code = r.json?.result?.code || r.json?.code;
  record('1win', !!code, {
    code, status: r.status,
    match: `${pick.team1 || '?'} vs ${pick.team2 || '?'}`,
    selection: `Winner "1" @ ${pick.cf} (oddId=${pick.oddId})`,
    url: code ? `https://1win.ng/betting?shareCode=${code}` : null,
    raw: code ? null : r.text.slice(0, 300),
  });
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
console.log('▶ PROBE COUPON CODES v5 — payloads EXACTS F12 user\n');
const tests = [
  ['sportybet', testSportybet],
  ['congobet', testCongobet],
  ['1xbet', testOnexbet],
  ['betmomo', testBetmomo],
  ['betpawa', testBetpawa],
  ['yellowbet', testYellowbet],
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
