#!/usr/bin/env node
// PROBE BASKET DUMP — dump markets bruts sur 2 matchs de basket par book.
// Books : 1xbet(sport=3), betmomo(sport.id=3), betpawa(cat=3),
//         sportybet(sr:sport:2), 1win(sportId=23).
// Format compact pour lecture logs : { book: [ { match, markets: [...] } ] }.
import WebSocket from 'ws';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36';

const banner = (t) => console.log(`\n═══════════ ${t} ═══════════`);

// ────────────────── 1xBET ──────────────────
async function probeXbet() {
  banner('1XBET basket sport=3');
  const FEED = 'https://1xbet.cg';
  const COUNTRY = 93, PARTNER = 192;
  const hdr = {
    accept: 'application/json',
    'user-agent': UA,
    origin: FEED,
    referer: `${FEED}/en/line`,
  };
  const proxies = [
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => u, // direct
  ];
  async function get(url) {
    for (const p of proxies) {
      try {
        const r = await fetch(p(url), { headers: hdr, signal: AbortSignal.timeout(10_000) });
        if (r.ok) return r.json();
      } catch { /* next */ }
    }
    return null;
  }
  // Liste basket via Get1x2_VZip top100 sport=3
  const list = await get(`${FEED}/service-api/LineFeed/Get1x2_VZip?sports=3&count=100&lng=en&mode=4&country=${COUNTRY}&partner=${PARTNER}&getEmpty=true`);
  const items = (list?.Value || []).filter(m => m.I && m.O1 && m.O2)
    .map(m => ({ id: m.I, home: m.O1, away: m.O2, league: m.LE || m.L || '' }));
  console.log(`  ${items.length} matchs listés`);
  const top = items.filter(m => /NBA|WNBA|Euroleague|EuroBasket|ACB|FIBA/i.test(m.league)).slice(0, 2);
  const picks = top.length >= 2 ? top : [...top, ...items.slice(0, 2 - top.length)];
  for (const m of picks) {
    console.log(`\n  ▶ ${m.home} vs ${m.away} [${m.league}] id=${m.id}`);
    const full = await get(`${FEED}/service-api/LineFeed/GetGameZip?id=${m.id}&lng=en&country=${COUNTRY}&partner=${PARTNER}&isSubGames=true&GroupEvents=true`);
    const GE = full?.Value?.GE || [];
    console.log(`    ${GE.length} groupes`);
    for (const g of GE) {
      const events = [];
      for (const sub of (g.E || [])) for (const it of (Array.isArray(sub) ? sub : [sub])) {
        if (it.C == null) continue;
        events.push(`T=${it.T}${it.P != null ? ` P=${it.P}` : ''}${it.G2 != null ? ` G2=${it.G2}` : ''} C=${it.C}`);
      }
      if (events.length) console.log(`    G=${g.G} "${g.GN || ''}" ×${events.length}: ${events.slice(0, 6).join(' | ')}${events.length > 6 ? ` … +${events.length - 6}` : ''}`);
    }
  }
}

// ────────────────── BETMOMO ──────────────────
async function probeBetmomo() {
  banner('BETMOMO basket sport.id=3');
  const ENDPOINT = 'wss://eu-swarm-newm.betconstruct.com/';
  return new Promise((resolve) => {
    const ws = new WebSocket(ENDPOINT);
    let done = false;
    const finish = () => { if (done) return; done = true; try { ws.close(); } catch { /* ignore */ } resolve(); };
    const hard = setTimeout(finish, 60_000);
    const pending = {}; let rid = 0;
    const send = (cmd, params) => new Promise((res) => {
      const r = 'r' + (++rid); pending[r] = res;
      ws.send(JSON.stringify({ command: cmd, params, rid: r }));
    });
    ws.on('error', () => { clearTimeout(hard); finish(); });
    ws.on('open', () => ws.send(JSON.stringify({ command: 'request_session', params: { site_id: 122, language: 'eng' }, rid: 's1' })));
    ws.on('message', async (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.rid === 's1') {
        if (!m.data?.sid) { console.log('  ❌ no sid'); clearTimeout(hard); return finish(); }
        try {
          const now = Math.floor(Date.now() / 1000);
          const listRes = await send('get', {
            source: 'betting',
            what: { sport: ['id'], region: ['name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name'] },
            where: { sport: { id: 3 }, game: { start_ts: { '@gt': now, '@lt': now + 604800 }, is_live: 0 } },
          });
          const games = [];
          for (const s of Object.values(listRes?.data?.data?.sport || {})) {
            for (const r of Object.values(s.region || {})) {
              for (const c of Object.values(r.competition || {})) {
                for (const g of Object.values(c.game || {})) games.push({ ...g, league: c.name || r.name || '' });
              }
            }
          }
          console.log(`  ${games.length} matchs listés`);
          const top = games.filter(g => /NBA|WNBA|Euroleague|EuroBasket|ACB|FIBA/i.test(g.league)).slice(0, 2);
          const picks = top.length >= 2 ? top : [...top, ...games.slice(0, 2 - top.length)];
          for (const g of picks) {
            console.log(`\n  ▶ ${g.team1_name} vs ${g.team2_name} [${g.league}] id=${g.id}`);
            const oddsRes = await send('get', {
              source: 'betting',
              what: { game: ['id'], market: ['name', 'type', 'col_count', 'group_name', 'group_id'], event: ['name', 'price', 'base', 'type_1', 'type'] },
              where: { game: { id: { '@eq': Number(g.id) } } },
            });
            const game = Object.values(oddsRes?.data?.data?.game || {})[0];
            const markets = game ? Object.values(game.market || {}) : [];
            console.log(`    ${markets.length} markets`);
            for (const mk of markets) {
              const events = Object.values(mk.event || {}).map(e => `${e.type || e.type_1 || '?'}${e.base != null ? `@${e.base}` : ''}"${e.name}"=${e.price}`);
              console.log(`    T="${mk.type || ''}" grp="${mk.group_name || ''}" name="${mk.name || ''}" ×${events.length}: ${events.slice(0, 5).join(' | ')}${events.length > 5 ? ` … +${events.length - 5}` : ''}`);
            }
          }
          clearTimeout(hard); finish();
        } catch (e) { console.log('  ERR:', e.message); clearTimeout(hard); finish(); }
      } else if (pending[m.rid]) { pending[m.rid](m); delete pending[m.rid]; }
    });
  });
}

// ────────────────── BETPAWA ──────────────────
async function probeBetpawa() {
  banner('BETPAWA basket categoryId=3');
  const BASE = 'https://cg.betpawa.com';
  const HDR_LIST = {
    Accept: 'application/x-protobuf', 'User-Agent': UA,
    'x-pawa-brand': 'betpawa-congobrazzaville', 'x-pawa-language': 'fr',
    Referer: `${BASE}/events?categoryId=3`, Cookie: 'bp_country=CG',
  };
  const HDR_EV = { ...HDR_LIST, Accept: 'application/json' };
  // List: buildEventsListUrl style, cat=3, marketTypes vide pour tout
  const q = { queries: [{ query: { eventType: 'UPCOMING', categories: ['3'], zones: {}, hasOdds: true }, view: { marketTypes: [] }, skip: 0, take: 30 }] };
  const listUrl = `${BASE}/api/sportsbook/v4/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`;
  const r = await fetch(listUrl, { headers: HDR_LIST, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return console.log(`  list HTTP ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  const strings = []; let cur = '';
  for (const b of buf) { if (b >= 32 && b <= 126) cur += String.fromCharCode(b); else { if (cur.length > 2) strings.push(cur); cur = ''; } }
  if (cur.length > 2) strings.push(cur);
  // Extraire IDs matches (7-10 digits) + noms teams (contient " - ")
  const matches = [];
  for (let i = 0; i < strings.length; i++) {
    if (!/^\d{7,10}$/.test(strings[i])) continue;
    const name = strings[i + 1] || '';
    if (!name.includes(' - ')) continue;
    const parts = name.split(' - ');
    if (parts.length < 2) continue;
    matches.push({ id: strings[i], home: parts[0].trim(), away: parts.slice(1).join(' - ').trim() });
    if (matches.length >= 15) break;
  }
  console.log(`  ${matches.length} matchs listés`);
  const picks = matches.slice(0, 2);
  for (const m of picks) {
    console.log(`\n  ▶ ${m.home} vs ${m.away} id=${m.id}`);
    const ev = await fetch(`${BASE}/api/sportsbook/v4/events/${m.id}`, { headers: HDR_EV, signal: AbortSignal.timeout(15_000) });
    if (!ev.ok) { console.log(`    event HTTP ${ev.status}`); continue; }
    const data = await ev.json();
    const mks = data?.markets || data?.marketList || [];
    console.log(`    league="${data.competitionName || data.category?.name || ''}" ${mks.length} markets`);
    for (const mk of mks.slice(0, 40)) {
      const prices = (mk.prices || mk.outcomes || []).map(p => `"${p.name || p.description || ''}"=${p.price ?? p.odds}`);
      const tid = mk.marketType?.id ?? mk.marketTypeId ?? mk.id;
      const tname = mk.marketType?.name ?? mk.name ?? '';
      console.log(`    id=${tid} "${tname}" ×${prices.length}: ${prices.slice(0, 4).join(' | ')}${prices.length > 4 ? ` … +${prices.length - 4}` : ''}`);
    }
  }
}

// ────────────────── SPORTYBET ──────────────────
async function probeSportybet() {
  banner('SPORTYBET basket sr:sport:2');
  const BASE = 'https://www.sportybet.com';
  const HDR = {
    'User-Agent': UA, Accept: '*/*',
    'Accept-Language': 'en',
    Referer: `${BASE}/ng/sport/basketball/today`,
    Origin: BASE,
    Cookie: 'locale=en; sb_country=ng',
    clientid: 'web', operid: '2', platform: 'web',
  };
  // pcUpcomingEvents SANS marketId : renvoie markets par défaut du sport
  const ts = Date.now();
  const listUrl = `${BASE}/api/ng/factsCenter/pcUpcomingEvents?sportId=${encodeURIComponent('sr:sport:2')}&pageSize=50&pageNum=1&option=1&timeline=24&sortOption=SORT_BY_DEFAULT&_t=${ts}`;
  const r = await fetch(listUrl, { headers: HDR, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) return console.log(`  list HTTP ${r.status}`);
  const data = await r.json();
  // Structure : data.data.tournaments[].events[]
  const events = [];
  for (const t of (data?.data?.tournaments || [])) {
    for (const e of (t.events || [])) events.push({ ...e, league: t.name });
  }
  console.log(`  ${events.length} matchs listés`);
  const top = events.filter(e => /NBA|WNBA|Euroleague|EuroBasket|ACB|FIBA/i.test(e.league || '')).slice(0, 2);
  const picks = top.length >= 2 ? top : [...top, ...events.slice(0, 2 - top.length)];
  for (const m of picks) {
    const h = m.homeTeamName || m.homeTeam?.name || '';
    const a = m.awayTeamName || m.awayTeam?.name || '';
    console.log(`\n  ▶ ${h} vs ${a} [${m.league}] id=${m.eventId}`);
    const ev = await fetch(`${BASE}/api/ng/factsCenter/event?eventId=${encodeURIComponent(m.eventId)}&productId=3&_t=${Date.now()}`, { headers: HDR, signal: AbortSignal.timeout(15_000) });
    if (!ev.ok) { console.log(`    event HTTP ${ev.status}`); continue; }
    const evData = await ev.json();
    const mks = evData?.data?.markets || [];
    console.log(`    ${mks.length} markets`);
    for (const mk of mks.slice(0, 40)) {
      const outs = (mk.outcomes || []).map(o => `"${o.desc}"${o.spread != null ? ` sp=${o.spread}` : ''}${o.handicap != null ? ` h=${o.handicap}` : ''}=${o.odds}`);
      console.log(`    id=${mk.id} spec=${mk.specifier || ''} "${mk.desc || mk.name || ''}" ×${outs.length}: ${outs.slice(0, 4).join(' | ')}${outs.length > 4 ? ` … +${outs.length - 4}` : ''}`);
    }
  }
}

// ────────────────── 1WIN ──────────────────
async function probeOnewin() {
  banner('1WIN basket sportId=23');
  const PLATFORM = '44ba10e5-7df2-47ab-a44d-dc93803c7a6e';
  const API_BASE = 'https://api-gateway.top-parser.com';
  const ORIGIN = 'https://1win.ng';
  const hdr = { 'Content-Type': 'application/json', Origin: ORIGIN, Referer: `${ORIGIN}/`, 'User-Agent': UA };
  const now = Math.floor(Date.now() / 1000);
  const body = { sportId: 23, startAtFrom: now - 3600, startAtTo: now + 3 * 86400, limit: 200, offset: 0, l: 'en-001', p: PLATFORM };
  const r = await fetch(`${API_BASE}/matches/get-many`, { method: 'POST', headers: hdr, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return console.log(`  list HTTP ${r.status}`);
  const data = await r.json();
  const items = (data?.result?.items || []).map(m => ({
    id: m.id,
    home: m.homeTeam?.name || m.competitors?.[0]?.name || '',
    away: m.awayTeam?.name || m.competitors?.[1]?.name || '',
    league: m.tournament?.name || '',
  })).filter(m => m.id && m.home && m.away);
  console.log(`  ${items.length} matchs listés`);
  const top = items.filter(m => /NBA|WNBA|Euroleague|EuroBasket|ACB|FIBA/i.test(m.league)).slice(0, 2);
  const picks = top.length >= 2 ? top : [...top, ...items.slice(0, 2 - top.length)];
  const matchIds = picks.map(p => p.id);
  if (!matchIds.length) return console.log('  ❌ no picks');
  // WS pull odds
  const url = `wss://api-gateway.top-parser.com/push-server-v2/?Language=en-001&externalPartnerId=${PLATFORM}&EIO=4&transport=websocket`;
  await new Promise((resolve) => {
    const ws = new WebSocket(url);
    const oddsByMatch = new Map();
    let started = false, lastUpdate = Date.now();
    let watchdog;
    const finish = () => { if (watchdog) clearInterval(watchdog); try { ws.close(); } catch { /* ignore */ } resolve(); };
    const hard = setTimeout(finish, 35_000);
    let phase = 0;
    ws.on('message', (raw) => {
      const msg = raw.toString();
      if (msg.startsWith('0') && phase === 0) { ws.send('40'); phase = 1; return; }
      if (msg.startsWith('40') && phase <= 1) {
        phase = 2;
        ws.send('42' + JSON.stringify(['subscribe', { messageType: 'subscribe-match-odds', data: { matchIds, isBaseOddsGroups: false } }]));
        watchdog = setInterval(() => {
          if (started && Date.now() - lastUpdate > 5000) {
            clearTimeout(hard);
            for (const p of picks) {
              console.log(`\n  ▶ ${p.home} vs ${p.away} [${p.league}] id=${p.id}`);
              const groups = oddsByMatch.get(p.id) || {};
              const names = Object.keys(groups);
              console.log(`    ${names.length} groupes`);
              for (const gname of names.slice(0, 40)) {
                const odds = groups[gname].map(o => `"${o.title || o.name || ''}"${o.value != null ? `=${o.value}` : ''}${o.line != null ? ` line=${o.line}` : ''}${o.handicap != null ? ` h=${o.handicap}` : ''}`);
                console.log(`    grp="${gname}" ×${odds.length}: ${odds.slice(0, 4).join(' | ')}${odds.length > 4 ? ` … +${odds.length - 4}` : ''}`);
              }
            }
            finish();
          }
        }, 500);
        return;
      }
      if (msg === '2') { ws.send('3'); return; }
      if (msg.startsWith('42')) {
        try {
          const payload = JSON.parse(msg.slice(2));
          const b = payload?.[1];
          if (b?.messageType === 'match-odds-snapshot' || b?.messageType === 'match-odds-update') {
            const mid = b.data?.matchId; if (!mid) return;
            const ex = oddsByMatch.get(mid) || {};
            for (const g of (b.data?.oddsGroups || [])) if (g.name && g.oddsList?.length) ex[g.name] = g.oddsList;
            oddsByMatch.set(mid, ex);
            started = true; lastUpdate = Date.now();
          }
        } catch { /* ignore */ }
      }
    });
    ws.on('error', finish);
    ws.on('close', finish);
  });
}

console.log('▶ PROBE BASKET DUMP — 5 books × 2 matchs\n');
for (const [name, fn] of [['1xbet', probeXbet], ['betmomo', probeBetmomo], ['betpawa', probeBetpawa], ['sportybet', probeSportybet], ['1win', probeOnewin]]) {
  try { await fn(); } catch (e) { console.log(`\n❌ ${name} ERR: ${e.message}`); }
}
console.log('\n═══ FIN ═══');
