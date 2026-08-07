#!/usr/bin/env node
// PROBE BASKET DUMP v2 — 3 books restants (betpawa/sportybet/1win)
// betpawa : bon path market.row[].prices[] (spec.hcp/spec.total, p.odds)
// sportybet : passe marketId= liste basket standard (evite HTTP 422)
// 1win : filtre (replays), watchdog 12s pour laisser arriver tous les groups
import WebSocket from 'ws';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36';
const banner = (t) => console.log(`\n═══════════ ${t} ═══════════`);

// ────────────────── BETPAWA ──────────────────
async function probeBetpawa() {
  banner('BETPAWA basket categoryId=3 v2 (fix row/prices/odds)');
  const BASE = 'https://cg.betpawa.com';
  const HDR = {
    'User-Agent': UA,
    'x-pawa-brand': 'betpawa-congobrazzaville', 'x-pawa-language': 'fr',
    Referer: `${BASE}/events?categoryId=3`, Cookie: 'bp_country=CG',
  };
  const HDR_LIST = { ...HDR, Accept: 'application/x-protobuf' };
  const HDR_EV = { ...HDR, Accept: 'application/json' };
  const q = { queries: [{ query: { eventType: 'UPCOMING', categories: ['3'], zones: {}, hasOdds: true }, view: { marketTypes: [] }, skip: 0, take: 30 }] };
  const listUrl = `${BASE}/api/sportsbook/v4/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`;
  const r = await fetch(listUrl, { headers: HDR_LIST, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return console.log(`  list HTTP ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  const strings = []; let cur = '';
  for (const b of buf) { if (b >= 32 && b <= 126) cur += String.fromCharCode(b); else { if (cur.length > 2) strings.push(cur); cur = ''; } }
  if (cur.length > 2) strings.push(cur);
  const matches = [];
  for (let i = 0; i < strings.length; i++) {
    if (!/^\d{7,10}$/.test(strings[i])) continue;
    const name = strings[i + 1] || '';
    if (!name.includes(' - ')) continue;
    const parts = name.split(' - ');
    if (parts.length < 2) continue;
    matches.push({ id: strings[i], home: parts[0].trim(), away: parts.slice(1).join(' - ').trim() });
    if (matches.length >= 6) break;
  }
  console.log(`  ${matches.length} matchs listés`);
  const picks = matches.slice(0, 2);
  for (const m of picks) {
    console.log(`\n  ▶ ${m.home} vs ${m.away} id=${m.id}`);
    const ev = await fetch(`${BASE}/api/sportsbook/v4/events/${m.id}`, { headers: HDR_EV, signal: AbortSignal.timeout(15_000) });
    if (!ev.ok) { console.log(`    event HTTP ${ev.status}`); continue; }
    const data = await ev.json();
    const mks = data?.markets || [];
    console.log(`    ${mks.length} markets`);
    for (const mk of mks) {
      const mid = mk?.marketType?.id;
      const mname = mk?.marketType?.name;
      const rows = mk?.row || [];
      const summary = [];
      for (const row of rows) {
        const spec = row?.specifier || {};
        const hcp = spec.hcp, total = spec.total;
        for (const p of (row.prices || [])) {
          summary.push(`"${p.name}"${hcp != null ? ` hcp=${hcp}` : ''}${total != null ? ` total=${total}` : ''}=${p.odds}`);
        }
      }
      console.log(`    id=${mid} "${mname}" rows=${rows.length}: ${summary.slice(0, 6).join(' | ')}${summary.length > 6 ? ` … +${summary.length - 6}` : ''}`);
    }
  }
}

// ────────────────── SPORTYBET ──────────────────
async function probeSportybet() {
  banner('SPORTYBET basket sr:sport:2 v2 (marketId=liste basket)');
  const BASE = 'https://www.sportybet.com';
  const HDR = {
    'User-Agent': UA, Accept: '*/*',
    'Accept-Language': 'en',
    Referer: `${BASE}/ng/sport/basketball/today`,
    Origin: BASE,
    Cookie: 'locale=en; sb_country=ng',
    clientid: 'web', operid: '2', platform: 'web',
  };
  // IDs basket standard SportyBet : 1=1x2, 18=Total, 14=Hcp, 60=WinnMargin,
  // 46=OddEven, 10=DC, 226=WinnerInclOT, 340=Hcp3way, 96=WinnerNoOT,
  // 60100=1MT_1x2, 42020=Q1Winner
  const mids = '1,18,14,60,46,10,226,340,96,60100,42020';
  const ts = Date.now();
  const listUrl = `${BASE}/api/ng/factsCenter/pcUpcomingEvents?sportId=${encodeURIComponent('sr:sport:2')}&marketId=${encodeURIComponent(mids)}&pageSize=50&pageNum=1&option=1&timeline=24&sortOption=SORT_BY_DEFAULT&_t=${ts}`;
  const r = await fetch(listUrl, { headers: HDR, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) return console.log(`  list HTTP ${r.status}`);
  const data = await r.json();
  const events = [];
  for (const t of (data?.data?.tournaments || [])) {
    for (const e of (t.events || [])) events.push({ ...e, league: t.name });
  }
  console.log(`  ${events.length} matchs listés`);
  const top = events.filter(e => /NBA|WNBA|Euroleague|EuroBasket|ACB|FIBA/i.test(e.league || '')).slice(0, 2);
  const picks = top.length >= 2 ? top : [...top, ...events.slice(0, 2 - top.length)];
  for (const m of picks) {
    const h = m.homeTeamName || '';
    const a = m.awayTeamName || '';
    console.log(`\n  ▶ ${h} vs ${a} [${m.league}] id=${m.eventId}`);
    const ev = await fetch(`${BASE}/api/ng/factsCenter/event?eventId=${encodeURIComponent(m.eventId)}&productId=3&_t=${Date.now()}`, { headers: HDR, signal: AbortSignal.timeout(15_000) });
    if (!ev.ok) { console.log(`    event HTTP ${ev.status}`); continue; }
    const evData = await ev.json();
    const mks = evData?.data?.markets || [];
    console.log(`    ${mks.length} markets`);
    for (const mk of mks) {
      const outs = (mk.outcomes || []).map(o => `"${o.desc}"${o.spread != null ? ` sp=${o.spread}` : ''}${o.handicap != null ? ` h=${o.handicap}` : ''}=${o.odds}`);
      console.log(`    id=${mk.id} spec=${mk.specifier || ''} "${mk.desc || mk.name || ''}" ×${outs.length}: ${outs.slice(0, 5).join(' | ')}${outs.length > 5 ? ` … +${outs.length - 5}` : ''}`);
    }
  }
}

// ────────────────── 1WIN ──────────────────
async function probeOnewin() {
  banner('1WIN basket sportId=23 v2 (skip replays, watchdog 12s)');
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
  })).filter(m => m.id && m.home && m.away
    && !/replay|\(v\)|\bcyber|virtual|simulated|\bsim\b/i.test(`${m.home} ${m.away} ${m.league}`));
  console.log(`  ${items.length} matchs listés (post-filtre replays)`);
  const top = items.filter(m => /NBA|WNBA|Euroleague|EuroBasket|ACB|FIBA/i.test(m.league)).slice(0, 2);
  const picks = top.length >= 2 ? top : [...top, ...items.slice(0, 2 - top.length)];
  if (!picks.length) return console.log('  ❌ no picks');
  const matchIds = picks.map(p => p.id);
  const url = `wss://api-gateway.top-parser.com/push-server-v2/?Language=en-001&externalPartnerId=${PLATFORM}&EIO=4&transport=websocket`;
  await new Promise((resolve) => {
    const ws = new WebSocket(url);
    const oddsByMatch = new Map();
    let started = false, lastUpdate = Date.now();
    let watchdog;
    const finish = () => { if (watchdog) clearInterval(watchdog); try { ws.close(); } catch { /* ignore */ } resolve(); };
    const hard = setTimeout(finish, 40_000);
    let phase = 0;
    ws.on('message', (raw) => {
      const msg = raw.toString();
      if (msg.startsWith('0') && phase === 0) { ws.send('40'); phase = 1; return; }
      if (msg.startsWith('40') && phase <= 1) {
        phase = 2;
        ws.send('42' + JSON.stringify(['subscribe', { messageType: 'subscribe-match-odds', data: { matchIds, isBaseOddsGroups: false } }]));
        watchdog = setInterval(() => {
          if (started && Date.now() - lastUpdate > 12_000) {
            clearTimeout(hard);
            for (const p of picks) {
              console.log(`\n  ▶ ${p.home} vs ${p.away} [${p.league}] id=${p.id}`);
              const groups = oddsByMatch.get(p.id) || {};
              const names = Object.keys(groups);
              console.log(`    ${names.length} groupes`);
              for (const gname of names) {
                const odds = groups[gname].map(o => {
                  const parts = [`"${o.title || o.name || ''}"`];
                  for (const k of ['value', 'line', 'handicap', 'total', 'coeff']) {
                    if (o[k] != null) parts.push(`${k}=${o[k]}`);
                  }
                  return parts.join(' ');
                });
                console.log(`    grp="${gname}" ×${odds.length}: ${odds.slice(0, 5).join(' | ')}${odds.length > 5 ? ` … +${odds.length - 5}` : ''}`);
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

console.log('▶ PROBE BASKET DUMP v2\n');
for (const [name, fn] of [['betpawa', probeBetpawa], ['sportybet', probeSportybet], ['1win', probeOnewin]]) {
  try { await fn(); } catch (e) { console.log(`\n❌ ${name} ERR: ${e.message}`); }
}
console.log('\n═══ FIN ═══');
