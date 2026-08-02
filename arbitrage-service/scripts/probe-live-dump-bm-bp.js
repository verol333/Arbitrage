// Probe live dump BetMomo + BetPawa : vérifier si les market types/IDs
// changent entre live et prematch (source de fake arbs comme sur PB).
import WebSocket from 'ws';

const log = (m) => console.log(m);

// ─── BETMOMO LIVE ─────────────────────────────────────────────
// BM utilise SWARM WebSocket (BetConstruct). market.type = string stable.
async function probeBMLive() {
  log('\n═══════════ BETMOMO LIVE DUMP ═══════════');
  const ENDPOINT = 'wss://eu-swarm-newm.betconstruct.com/';
  const SITE_ID = 122;
  return new Promise((resolve) => {
    let done = false;
    const ws = new WebSocket(ENDPOINT);
    const timer = setTimeout(() => { if (!done) { done = true; ws.close(); log('BM timeout'); resolve(); } }, 30_000);
    const pending = {};
    let ridN = 0;
    const send = (what, where) => new Promise((res) => {
      const rid = 'r' + (++ridN);
      pending[rid] = res;
      ws.send(JSON.stringify({ command: 'get', params: { source: 'betting', what, where }, rid }));
    });
    ws.on('open', () => ws.send(JSON.stringify({ command: 'request_session', params: { site_id: SITE_ID, language: 'eng' }, rid: 's1' })));
    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.rid === 's1') {
        if (!msg?.data?.sid) { log('BM no sid'); done = true; clearTimeout(timer); ws.close(); return resolve(); }
        try {
          // List live football games (sport id=1, type=1 = live)
          const games = await send(
            { game: ['id', 'team1_name', 'team2_name', 'is_live'] },
            { sport: { id: { '@eq': 1 } }, game: { type: { '@eq': 1 } } },
          );
          const sport = Object.values(games?.sport || {})[0];
          const region = Object.values(sport?.region || {})[0];
          const competition = Object.values(region?.competition || {})[0];
          const gameList = Object.values(competition?.game || {});
          log(`  ${gameList.length} live football games`);
          if (!gameList.length) { done = true; clearTimeout(timer); ws.close(); return resolve(); }

          for (const g of gameList.slice(0, 2)) {
            log(`\n  ── ${g.team1_name} vs ${g.team2_name} — id=${g.id}`);
            const oddsData = await send(
              { game: ['id'], market: ['name', 'type', 'col_count', 'group_name', 'group_id'], event: ['name', 'price', 'base', 'type_1', 'type'] },
              { game: { id: { '@eq': Number(g.id) } } },
            );
            const gg = Object.values(oddsData?.game || {})[0];
            const markets = gg ? Object.values(gg.market || {}) : [];
            log(`     ${markets.length} markets:`);
            for (const m of markets.slice(0, 30)) {
              const type = m.type || '';
              const evs = Array.isArray(m.event) ? m.event : Object.values(m.event || {});
              const outcomes = evs.slice(0, 4).map((e) => `${e.type_1 || e.type || e.name}=${e.price}`).join(' ');
              log(`       type="${type}" name="${m.name || ''}" outcomes=[${outcomes}]`);
            }
          }
          done = true; clearTimeout(timer); ws.close(); resolve();
        } catch (e) {
          log(`BM err: ${e.message}`);
          done = true; clearTimeout(timer); ws.close(); resolve();
        }
      } else if (pending[msg.rid]) {
        const r = pending[msg.rid];
        delete pending[msg.rid];
        r(msg?.data?.data);
      }
    });
    ws.on('error', () => { if (!done) { done = true; clearTimeout(timer); resolve(); } });
  });
}

// ─── BETPAWA LIVE ───────────────────────────────────────────
const BP_HDR = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.7',
  'User-Agent': 'Mozilla/5.0 Chrome/150.0.0.0',
  'x-pawa-brand': 'betpawa-congobrazzaville',
  'x-pawa-language': 'fr',
  'Referer': 'https://cg.betpawa.com/events',
  'Cookie': 'bp_country=CG',
};

// IDs mappés dans notre parseur BP (extraits de parse.js)
const BP_MAPPED = new Set(['3743','4693','3795','4703','5000','5006','5003','4833','3668','4673','3789','4697','4958','4794','3685','4681','3792','4700','4976','4809','4728']);

async function probeBPLive() {
  log('\n═══════════ BETPAWA LIVE DUMP ═══════════');
  // Get live events via by-queries (with LIVE eventType)
  const q = { queries: [{ query: { eventType: 'LIVE', categories: ['2'], zones: {}, hasOdds: true }, view: { marketTypes: ['3743'] }, skip: 0, take: 5 }] };
  const listUrl = `https://cg.betpawa.com/api/sportsbook/v4/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`;
  const HDR_LIST = { ...BP_HDR, 'Accept': 'application/x-protobuf' };
  try {
    const listRes = await fetch(listUrl, { headers: HDR_LIST, signal: AbortSignal.timeout(20_000) });
    const buf = new Uint8Array(await listRes.arrayBuffer());
    const strings = [];
    let cur = '';
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      if (b >= 32 && b <= 126) cur += String.fromCharCode(b);
      else { if (cur.length > 2) strings.push(cur); cur = ''; }
    }
    if (cur.length > 2) strings.push(cur);
    const ids = strings.filter((s) => /^\d{7,10}$/.test(s)).filter((s) => !['3743', '4693'].includes(s)).slice(0, 3);
    log(`[list] found ${ids.length} live event IDs (sample)`);
    if (!ids.length) { log('No live BP events'); return; }

    for (const id of ids) {
      log(`\n── BP event ${id}`);
      const eventUrl = `https://cg.betpawa.com/api/sportsbook/v4/events/${id}`;
      const HDR_EV = { ...BP_HDR, 'Accept': 'application/json' };
      try {
        const res = await fetch(eventUrl, { headers: HDR_EV, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) { log(`  status=${res.status}`); continue; }
        const j = await res.json();
        const markets = j?.markets || [];
        log(`  ${markets.length} markets:`);
        for (const m of markets.slice(0, 25)) {
          const id = String(m?.marketType?.id ?? '');
          const name = m?.marketType?.name || '';
          const mapped = BP_MAPPED.has(id) ? '✅' : '❌ NON MAPPÉ';
          // Get first few outcomes
          const rows = m.row || [];
          const prices = rows.slice(0, 1).flatMap((r) => (r.prices || []).slice(0, 4).map((p) => `${p.name || p.displayName}=${p.odds || p.price}`)).join(' ');
          log(`    id=${id} name="${name}" ${mapped} outcomes=[${prices}]`);
        }
      } catch (e) { log(`  err ${e.message}`); }
    }
  } catch (e) { log(`BP list err: ${e.message}`); }
}

await probeBMLive();
await probeBPLive();
log('\nDONE');
