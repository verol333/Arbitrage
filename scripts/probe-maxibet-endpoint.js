#!/usr/bin/env node
// PROBE COUPON CODES — genere de vrais codes coupons sur les 5 books explores
// et les affiche pour verification manuelle par le user.
// Pour chaque book : pick 1 match foot upcoming, prend le 1X2 Home, call SaveCoupon.
import WebSocket from 'ws';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

async function fetchJson(url, opts = {}) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, ...(opts.headers || {}) }, method: opts.method || 'GET', body: opts.body, signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, text, json };
  } catch (e) { return { status: 0, err: e.message, text: '', json: null }; }
}

// ─────────────────────────────────────────────────────────────────
// 1) SPORTYBET — POST /api/ng/orders/share  body [{eventId, marketId, outcomeId}]
// ─────────────────────────────────────────────────────────────────
async function testSportybet() {
  console.log('\n═══ SPORTYBET ═══');
  // Fetch upcoming football events
  const list = await fetchJson('https://www.sportybet.com/api/ng/factsCenter/pcUpcomingEvents?sportId=sr:sport:1&marketId=1,18,29,10,11,26,16,60,68&pageNum=1&option=1&_t=' + Date.now());
  const events = list.json?.data?.tournaments?.flatMap(t => t.events || []) || list.json?.data?.events || [];
  const withOdds = events.filter(e => e?.markets?.[0]?.outcomes?.[0]?.odds && Number(e.markets[0].outcomes[0].odds) > 1.2 && Number(e.markets[0].outcomes[0].odds) < 5);
  const pick = withOdds[0];
  if (!pick) return console.log('  ❌ Pas de match trouve');
  const eventId = pick.eventId;
  const market = pick.markets.find(m => String(m.id) === '1');
  const home = market?.outcomes?.find(o => String(o.desc).toLowerCase() === 'home');
  if (!home) return console.log('  ❌ Pas de 1X2 Home');
  console.log(`  Match : ${pick.homeTeamName} vs ${pick.awayTeamName} [${pick.sport?.category?.tournament?.name || pick.tournamentName || '?'}]`);
  console.log(`  Selection : 1X2 Home @ ${home.odds}`);
  console.log(`  IDs : eventId=${eventId} marketId=1 outcomeId=${home.id}`);
  const body = JSON.stringify([{ eventId, marketId: '1', outcomeId: String(home.id) }]);
  const r = await fetchJson('https://www.sportybet.com/api/ng/orders/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  console.log(`  → HTTP ${r.status}`);
  if (r.json?.data?.shareCode) {
    console.log(`  ✅ CODE = ${r.json.data.shareCode}`);
    console.log(`  URL = ${r.json.data.shareURL}`);
  } else console.log(`  ⚠️  ${(r.text || '').slice(0, 250)}`);
}

// ─────────────────────────────────────────────────────────────────
// 2) BETPAWA — POST /api/sportsbook/v3/booking-number
// ─────────────────────────────────────────────────────────────────
async function testBetpawa() {
  console.log('\n═══ BETPAWA ═══');
  // BetPawa fetch upcoming via /events/lists/by-queries (protobuf) — pour trouver un event
  // Approche simple : hardcode un match connu qui est en upcoming
  // Alternative : POST directement avec selection format probable
  const url = 'https://cg.betpawa.com/api/sportsbook/v3/booking-number';
  // Format observe : {selections:[{id, price, marketId, eventId?}]}
  // Sans exemple exact du body, on log l'endpoint et le format attendu
  console.log(`  Endpoint : POST ${url}`);
  console.log(`  Body attendu : {selections:[{...}]} (format precis a valider avec F12 avant test)`);
  console.log(`  ⚠️  Test skip : besoin d'un exemple de body BetPawa exact — probe suivante`);
}

// ─────────────────────────────────────────────────────────────────
// 3) CONGOBET — POST /api/betting/get-my-code avec eventBetTypeItemIds
// ─────────────────────────────────────────────────────────────────
async function testCongobet() {
  console.log('\n═══ CONGOBET ═══');
  const list = await fetchJson('https://congobet.net/api/events/upcoming?sportId=1&limit=20');
  const events = list.json?.data || [];
  const pick = events.find(e => (e.eventBetTypes || []).some(bt => Number(bt.betTypeId) === 10001 && (bt.eventBetTypeItems || []).length >= 3));
  if (!pick) return console.log('  ❌ Pas de match avec 1X2');
  const bt1x2 = pick.eventBetTypes.find(bt => Number(bt.betTypeId) === 10001);
  const home = bt1x2.eventBetTypeItems.find(it => (it.shortName || '').trim() === '1');
  if (!home) return console.log('  ❌ Pas de 1X2 outcome "1"');
  console.log(`  Match : ${pick.homeTeamName} vs ${pick.awayTeamName}`);
  console.log(`  Selection : 1X2 "1" (Domicile) @ ${home.odds}`);
  console.log(`  eventBetTypeItemId = ${home.id}`);
  const body = JSON.stringify({
    totalOdds: Number(home.odds),
    eventBetTypeItemIds: [Number(home.id)],
    betCategory: 'SportsFixedOdds',
    betSystemType: 'Simple',
    drawGameSelections: [],
    manualOddsBoostIds: [],
    maxPayout: 300,
    oddsBoostIds: [],
    stakePerLine: [50],
    totalStake: 50,
    hasBetBuilderBetLines: false,
  });
  const r = await fetchJson('https://hg-betting-api-prod.sporty-tech.net/api/betting/get-my-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://congobet.net', Referer: 'https://congobet.net/' },
    body,
  });
  console.log(`  → HTTP ${r.status}`);
  if (r.json?.code) console.log(`  ✅ CODE = ${r.json.code}`);
  else console.log(`  ⚠️  ${(r.text || '').slice(0, 300)}`);
}

// ─────────────────────────────────────────────────────────────────
// 4) BETMOMO — SWARM place_coupon isBooking:true
// ─────────────────────────────────────────────────────────────────
async function testBetmomo() {
  console.log('\n═══ BETMOMO ═══');
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://eu-swarm-newm.betconstruct.com/');
    let done = false;
    const finish = () => { if (done) return; done = true; try { ws.close(); } catch {} resolve(); };
    const t = setTimeout(finish, 20000);
    const pending = {}; let rid = 0;
    const send = (cmd, params) => new Promise((res) => {
      const r = 'r' + (++rid); pending[r] = res;
      ws.send(JSON.stringify({ command: cmd, params, rid: r }));
    });
    ws.on('open', () => ws.send(JSON.stringify({ command: 'request_session', params: { site_id: 122, language: 'eng' }, rid: 's1' })));
    ws.on('message', async (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.rid === 's1') {
        if (!m.data?.sid) { console.log('  ❌ no sid'); clearTimeout(t); return finish(); }
        // Find un match foot upcoming
        const now = Math.floor(Date.now() / 1000);
        const games = await send('get', { source: 'betting', what: { game: ['id', 'team1_name', 'team2_name'], market: ['id', 'type', 'name'], event: ['id', 'price', 'type_1', 'type'] }, where: { sport: { id: 1 }, game: { start_ts: { '@gt': now, '@lt': now + 86400 }, is_live: 0 }, market: { type: 'P1XP2' } } });
        let pick = null;
        for (const s of Object.values(games?.data?.sport || {})) {
          for (const r of Object.values(s.region || {})) for (const c of Object.values(r.competition || {})) for (const g of Object.values(c.game || {})) {
            const m1x2 = Object.values(g.market || {})[0];
            const home = Object.values(m1x2?.event || {}).find(e => (e.type_1 || e.type) === 'W1' || (e.type_1 || e.type) === '1');
            if (home && Number(home.price) > 1.5 && Number(home.price) < 3) { pick = { game: g, event: home, market: m1x2 }; break; }
          }
          if (pick) break;
        }
        if (!pick) { console.log('  ❌ pas de match'); clearTimeout(t); return finish(); }
        console.log(`  Match : ${pick.game.team1_name} vs ${pick.game.team2_name}`);
        console.log(`  Selection : 1X2 Home @ ${pick.event.price} (eventId=${pick.event.id})`);
        // SWARM place_coupon with is_booking
        const bookRes = await send('do', {
          command: 'place_coupon',
          params: {
            type: 1, source: 12, mode: 5, use_amount_only: 1,
            is_booking: true,
            each_way: [], amount: 0,
            events: [{ event_id: Number(pick.event.id), price: Number(pick.event.price) }],
          },
        }).catch(() => null);
        console.log('  Response :', JSON.stringify(bookRes?.data || bookRes || {}).slice(0, 400));
        clearTimeout(t); finish();
      } else if (pending[m.rid]) { pending[m.rid](m); delete pending[m.rid]; }
    });
    ws.on('error', () => { clearTimeout(t); finish(); });
  });
}

// ─────────────────────────────────────────────────────────────────
// 5) YELLOWBET — POST /placebetsport isBooking:true
// ─────────────────────────────────────────────────────────────────
async function testYellowbet() {
  console.log('\n═══ YELLOWBET ═══');
  console.log('  Endpoint : POST https://yellowbet.cg/services/clapi/api/Bet/placebetsport');
  console.log('  Body : {isBooking:true, selections:[{key:"E{eventId}B{betTypeId}O{oddKey}X", ...}], rows:[{amount:0, selectionKeys:[...]}]}');
  console.log('  ⚠️  Test skip : YellowBet est protege Cloudflare stealth, requiert workflow avec proxy config');
}

// ─── MAIN ───
console.log('▶ PROBE COUPON CODES — generate real codes for user verification\n');
try { await testSportybet(); } catch (e) { console.log('  ERR', e.message); }
try { await testCongobet(); } catch (e) { console.log('  ERR', e.message); }
try { await testBetmomo(); } catch (e) { console.log('  ERR', e.message); }
try { await testBetpawa(); } catch (e) { console.log('  ERR', e.message); }
try { await testYellowbet(); } catch (e) { console.log('  ERR', e.message); }
console.log('\n═══ FIN — copie-colle les codes dans les apps pour verifier ═══');
