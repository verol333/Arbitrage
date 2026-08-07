#!/usr/bin/env node
// PROBE COUPON CODES v4 — fix majeur 1xBet (via megapari.africa + x-app-n headers)
// exactement comme le code Base44 prod du user.
// Autres books : corrections + dump structure pour investigation.
import WebSocket from 'ws';
import { gotScraping } from 'got-scraping';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
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
  if (info.raw) console.log(`     raw: ${String(info.raw).slice(0, 350)}`);
  if (info.url) console.log(`     url: ${info.url}`);
};

// ═══════════════════════════════════════════════════════════════
// 1) SPORTYBET — endpoint public confirme + headers minimum
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
    '&marketId=1&pageNum=1&option=1&_t=' + Date.now(),
    { headers: SB_HDR }
  );
  const events = list.json?.data?.tournaments?.flatMap(t => t.events || []) || [];
  // Le F12 user montre : eventId + marketId + outcomeId suffit. Prendre n'importe quel match futur
  const pick = events.find(e => {
    const m = e.markets?.find(mk => String(mk.id) === '1');
    return m?.outcomes?.length > 0;
  });
  if (!pick) return record('sportybet', false, { err: `${events.length} evts, aucun avec market 1` });
  const market = pick.markets.find(m => String(m.id) === '1');
  const home = market.outcomes.find(o => String(o.desc).toLowerCase() === 'home') || market.outcomes[0];
  const body = JSON.stringify([{ eventId: pick.eventId, marketId: '1', outcomeId: String(home.id) }]);
  const r = await fetchRaw('https://www.sportybet.com/api/ng/orders/share', {
    method: 'POST', headers: { ...SB_HDR, 'Content-Type': 'application/json' }, body,
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
  if (!pick) return record('congobet', false, { err: 'no event with 1X2 valid' });
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
// 3) 1XBET — FIX MAJEUR : passe via megapari.africa (miroir Base44 prod)
// Headers x-app-n + x-svc-source OBLIGATOIRES, CheckCf:1, PlayersDuel, PV:null
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
  // Fetch 1 match football via megapari LineFeed
  const line = await fetchRaw(
    'https://megapari.africa/service-api/LineFeed/Get1x2_VZip?sports=1&count=50&lng=fr&mode=4&country=93&partner=192',
    { headers: MP_HEADERS }
  );
  const evts = line?.json?.Value || [];
  const pick = evts.find(e => e.E > 1.4 && e.E < 4 && e.O1 && e.O2 && (e.CI || e.I));
  if (!pick) return record('1xbet', false, { err: `${evts.length} evts megapari, aucun valide`, status: line.status, raw: line.text.slice(0, 200) });
  const gameId = pick.CI || pick.I;
  // Payload EXACT du prod Base44
  const body = JSON.stringify({
    notWait: true, CheckCf: 1, partner: 192, Summ: 500,
    Events: [{
      GameId: gameId, Type: 1, Coef: pick.E, Param: 0,
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
    match: `${pick.O1} vs ${pick.O2}`,
    selection: `1X2 "1" @ ${pick.E} (GameId=${gameId})`,
    url: code ? `https://megapari.africa/fr/list/coupon/${code}` : null,
    raw: code ? null : r.text.slice(0, 300),
  });
}

// ═══════════════════════════════════════════════════════════════
// 4) BETMOMO — SWARM WS pour trouver un event, puis image-creator/share-booking
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
        // Query TOUS les events P1XP2, prendre le premier
        const games = await send('get', {
          source: 'betting',
          what: { game: ['id', 'team1_name', 'team2_name'], market: ['id', 'type'], event: ['id', 'price', 'type_1', 'type', 'name'] },
          where: {
            sport: { id: 1 },
            game: { start_ts: { '@gt': now + 1800, '@lt': now + 172800 }, is_live: 0 },
            market: { type: 'P1XP2' },
          },
        });
        // Take FIRST event with valid price (peu importe home/away)
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
  if (!pick) return record('betmomo', false, { err: 'no match via SWARM' });
  // Body BetConstruct image-creator/share-booking (extrait F12 user)
  // Le body minimal contient siteId, events avec eventId+gameId+price+type
  const bodies = [
    {
      siteId: 211, lang: 'fra',
      events: [{ eventId: Number(pick.event.id), gameId: Number(pick.game.id), price: Number(pick.event.price), type: pick.event.type_1 || '1' }],
      betType: 1,
    },
    {
      site_id: 211, lang: 'fra',
      events: [{ event_id: Number(pick.event.id), game_id: Number(pick.game.id), price: Number(pick.event.price) }],
    },
    // Format observé dans réponse F12 : {betslip: {events: [...]}}
    {
      siteId: 211, lang: 'fra', currencyName: '₣',
      betslip: {
        events: [{ eventId: Number(pick.event.id), gameId: Number(pick.game.id), price: Number(pick.event.price), team1Name: pick.game.team1_name, team2Name: pick.game.team2_name }],
        betType: 1,
      },
    },
  ];
  for (let i = 0; i < bodies.length; i++) {
    const r = await fetchRaw('https://winners.bcapps.org/image-creator/share-booking/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://www.betmomo.com', Referer: 'https://www.betmomo.com/',
      },
      body: JSON.stringify(bodies[i]),
    });
    const bookId = r.json?.share?.bookId || r.json?.bookId || r.json?.book_id;
    const link = r.json?.share?.bookingLink;
    if (bookId) return record('betmomo', true, {
      code: String(bookId), status: r.status,
      match: `${pick.game.team1_name} vs ${pick.game.team2_name}`,
      selection: `1X2 @ ${pick.event.price} (body variant ${i + 1})`,
      url: link || `https://www.betmomo.com?bookingId${bookId}`,
    });
    if (i === bodies.length - 1) return record('betmomo', false, {
      status: r.status, err: `${bodies.length} body variants failed`, raw: r.text.slice(0, 300),
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// 5) BETPAWA — dump structure prices pour voir les IDs
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
  const ids = [...new Set(strings.filter(s => /^\d{7,10}$/.test(s) && s !== '3743'))].slice(0, 5);
  if (!ids.length) return record('betpawa', false, { err: 'no ids' });
  // Dump 1er event pour voir structure exacte des prices
  const detail = await fetchRaw(`https://cg.betpawa.com/api/sportsbook/v4/events/${ids[0]}`, { headers: BP_HDR_EVENT });
  const ev = detail.json;
  const market = ev?.markets?.find(m => String(m.marketType?.id) === '3743');
  const price = market?.row?.[0]?.prices?.[0];
  console.log(`     dump structure price: ${JSON.stringify(price).slice(0, 300)}`);
  if (!price?.id) return record('betpawa', false, { err: 'no price.id — voir dump' });
  // Vraie observation F12 user : POST booking-number renvoie {code:"65FNKJA"}
  // Body probable inclut priceId + eventId + selectionAdd/isProposed
  const bodies = [
    { selections: [{ id: price.id, price: String(price.odds) }] },
    { selections: [{ priceId: price.id, price: String(price.odds) }] },
    { selections: [{ id: price.id, price: price.odds }], stake: 100 },
    { selections: [{ eventId: ids[0], marketTypeId: 3743, priceId: price.id, price: String(price.odds) }] },
  ];
  for (let i = 0; i < bodies.length; i++) {
    const r = await fetchRaw('https://cg.betpawa.com/api/sportsbook/v3/booking-number', {
      method: 'POST',
      headers: { ...BP_HDR_EVENT, 'Content-Type': 'application/json', Origin: 'https://cg.betpawa.com' },
      body: JSON.stringify(bodies[i]),
    });
    const code = r.json?.code || r.json?.bookingNumber;
    if (code) return record('betpawa', true, {
      code, status: r.status, match: ev.name || `event ${ids[0]}`,
      selection: `1X2 @ ${price.odds}`,
      url: `https://cg.betpawa.com/booking/${code}`,
    });
    if (i === 0) console.log(`     variant ${i+1} → HTTP ${r.status}: ${r.text.slice(0, 150)}`);
  }
  record('betpawa', false, { err: 'all bodies failed — need F12 exact body from user' });
}

// ═══════════════════════════════════════════════════════════════
// 6) YELLOWBET — dump 3 bts pour voir les vrais names
// ═══════════════════════════════════════════════════════════════
const YB_HDR = { brandid: '122', channelid: '4', language: 'fr', terminal: 'yellowbet.cg' };
async function testYellowbet() {
  console.log('\n─── YELLOWBET ───');
  const list = await stealthRaw('https://yellowbet.cg/services/evapi/event/GetEvents?skip=0&take=500&count=500', { headers: YB_HDR });
  if (list.status !== 200) return record('yellowbet', false, { status: list.status, err: 'CF blocked' });
  const events = Array.isArray(list.json?.data) ? list.json.data : [];
  const candidates = events.filter(e => !e.lv);
  if (!candidates.length) return record('yellowbet', false, { err: 'catalog vide' });
  // Prendre 1er event et DUMP toutes les bts pour comprendre les names
  const ev = candidates[0];
  const det = await stealthRaw(`https://yellowbet.cg/services/evapi/event/GetEventDetails?id=${encodeURIComponent(ev.id)}`, { headers: YB_HDR });
  const bts = Array.isArray(det.json?.data?.bts) ? det.json.data.bts : [];
  console.log(`     Event : ${ev.h} vs ${ev.a}, ${bts.length} bts`);
  for (const bt of bts.slice(0, 5)) {
    console.log(`       bt id=${bt.id} n="${bt.n}" odds_keys=[${(bt.odds || bt.oc || []).slice(0, 3).map(o => o.k || o.oddkey || o.n).join(',')}]`);
  }
  // Chercher un bt qui ressemble à 1X2/résultat
  const bt1x2 = bts.find(b => /^(ft\s*1x2|1x2|match\s*result|résultat|resultat)$/i.test((b.n || '').trim()))
    || bts.find(b => (b.odds || b.oc || []).length === 3);
  if (!bt1x2) return record('yellowbet', false, { err: `${bts.length} bts mais aucun 1X2 identifie` });
  const odds = bt1x2.odds || bt1x2.oc || [];
  const home = odds[0]; // premier outcome
  const oddKey = home.k || home.oddkey || '1';
  const key = `E${ev.id}B${bt1x2.id}O${oddKey}X`;
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
  record('yellowbet', !!code, {
    code, status: r.status,
    match: `${ev.h} vs ${ev.a}`,
    selection: `${bt1x2.n} "${oddKey}" @ ${home.p || home.price || home.odd}`,
    url: code ? `https://yellowbet.cg/booking/${code}` : null,
    raw: code ? null : (r.text || '').slice(0, 300),
  });
}

// ═══════════════════════════════════════════════════════════════
// 7) 1WIN — WS push-server-v2 avec messageType correct
// ═══════════════════════════════════════════════════════════════
async function fetchOnewinData() {
  return new Promise((resolve) => {
    const url = 'wss://api-gateway.top-parser.com/push-server-v2/?Language=en-001&externalPartnerId=44ba10e5-7df2-47ab-a44d-dc93803c7a6e&EIO=4&transport=websocket';
    const ws = new WebSocket(url);
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { ws.close(); } catch { /* ignore */ } resolve(v); };
    const hard = setTimeout(() => finish(null), 15_000);
    ws.on('error', () => finish(null));
    const matches = new Map();
    ws.on('message', (raw) => {
      const m = raw.toString();
      if (m.startsWith('0')) { ws.send('40'); return; }
      if (m.startsWith('40')) {
        // Try multiple subscribe types
        ws.send('42' + JSON.stringify(['subscribe', { messageType: 'subscribe-line', data: { sportId: 18 } }]));
        ws.send('42' + JSON.stringify(['subscribe', { messageType: 'subscribe-line-matches', data: { sportId: 18 } }]));
        ws.send('42' + JSON.stringify(['subscribe', { messageType: 'subscribe-sport', data: { sportId: 18 } }]));
        return;
      }
      if (m === '2') { ws.send('3'); return; }
      if (m.startsWith('42')) {
        try {
          const p = JSON.parse(m.slice(2));
          const b = p[1];
          if (b?.data) {
            const items = b.data.matches || b.data.events || b.data.items || b.data;
            if (Array.isArray(items)) {
              for (const it of items) if (it.id) matches.set(it.id, it);
            }
            if (matches.size > 0) { clearTimeout(hard); setTimeout(() => finish([...matches.values()]), 2000); }
          }
        } catch { /* ignore */ }
      }
    });
  });
}
async function testOnewin() {
  console.log('\n─── 1WIN ───');
  const matches = await fetchOnewinData();
  if (!matches?.length) return record('1win', false, { err: 'no matches from WS (all subscribes failed)' });
  console.log(`     Got ${matches.length} matches, sample: ${JSON.stringify(matches[0]).slice(0, 200)}`);
  record('1win', false, { err: 'endpoint list OK mais generation code non implementee sans F12 exact' });
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
console.log('▶ PROBE COUPON CODES v4 — 1xBet via megapari.africa + fixes autres books\n');
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
