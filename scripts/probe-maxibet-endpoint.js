#!/usr/bin/env node
// Diagnostic complet Maxibet — identifie technologie backend + endpoints.
// A executer depuis un environnement avec acces direct a m.maxibet.bet
// (laptop user au Congo/CM, ou runner GH Actions).
//
// Etapes :
//  1) Fetch homepage HTML → cherche site_id / swarm URL / api base
//  2) Fetch les bundles JS principaux → cherche patterns BetConstruct/Digitain/SBTech
//  3) Tente une connexion SWARM avec site_ids candidats (site_id BetMomo=122)
//  4) Si SWARM OK : dump les sports + un exemple de match
//
// Usage : node scripts/probe-maxibet-endpoint.js
// Env facultatif : MAXIBET_SITE_ID=xxx pour forcer un site_id candidat.
import WebSocket from 'ws';

const HOSTS = [
  'https://m.maxibet.bet',
  'https://www.maxibet.bet',
  'https://maxibet.bet',
];
const HDR = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
};

async function fetchText(url, timeoutMs = 20000) {
  try {
    const r = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(timeoutMs) });
    return { status: r.status, text: r.ok ? await r.text() : '', headers: Object.fromEntries(r.headers.entries()) };
  } catch (e) { return { status: 0, err: e.message, text: '' }; }
}

const PATTERNS = {
  betconstruct: /betconstruct|swarm|springbme|spring-bme|sb-front-office/i,
  digitain: /digitain|dgtn|digitainapi/i,
  sbtech: /sbtech|sbstack/i,
  altenar: /altenar|altenarapi/i,
  playtech: /playtech|iflex/i,
  swarmUrl: /wss?:\/\/[a-z0-9.-]*swarm[a-z0-9.-]*\.[a-z]+[^"'\s)]*/gi,
  siteId: /site[_-]?id["'\s:=]+(\d{2,6})/gi,
  apiBase: /https?:\/\/[a-z0-9.-]+\.maxibet\.bet[a-z0-9\/._-]*/gi,
};

console.log('═══ 1) HOMEPAGES ═══');
const found = { techs: new Set(), swarmUrls: new Set(), siteIds: new Set(), apiBases: new Set(), scripts: new Set() };
for (const host of HOSTS) {
  console.log(`\n▶ ${host}`);
  const r = await fetchText(host);
  console.log(`  status=${r.status} bytes=${r.text.length}${r.err ? ' err=' + r.err : ''}`);
  if (!r.text) continue;
  console.log(`  server=${r.headers?.server || '?'}  x-powered=${r.headers?.['x-powered-by'] || '?'}`);

  for (const [tech, pat] of Object.entries(PATTERNS)) {
    if (['swarmUrl', 'siteId', 'apiBase'].includes(tech)) continue;
    if (pat.test(r.text)) { found.techs.add(tech); console.log(`  → tech match: ${tech}`); }
  }
  for (const m of r.text.matchAll(PATTERNS.swarmUrl)) found.swarmUrls.add(m[0]);
  for (const m of r.text.matchAll(PATTERNS.siteId)) found.siteIds.add(m[1]);
  for (const m of r.text.matchAll(PATTERNS.apiBase)) found.apiBases.add(m[0]);
  // Collect scripts
  for (const m of r.text.matchAll(/<script[^>]+src="([^"]+)"/gi)) found.scripts.add(m[1]);
}

console.log('\n═══ 2) SCRIPTS BUNDLES ═══');
const bundles = [...found.scripts].slice(0, 15);
for (const src of bundles) {
  const url = src.startsWith('http') ? src : (src.startsWith('//') ? 'https:' + src : `https://m.maxibet.bet${src.startsWith('/') ? '' : '/'}${src}`);
  const r = await fetchText(url);
  if (!r.text || r.text.length < 500) continue;
  console.log(`\n▶ ${url} (${r.text.length}b)`);
  let hits = 0;
  for (const [tech, pat] of Object.entries(PATTERNS)) {
    if (['swarmUrl', 'siteId', 'apiBase'].includes(tech)) continue;
    if (pat.test(r.text)) { found.techs.add(tech); console.log(`  tech: ${tech}`); hits++; }
  }
  for (const m of r.text.matchAll(PATTERNS.swarmUrl)) { found.swarmUrls.add(m[0]); hits++; }
  for (const m of r.text.matchAll(PATTERNS.siteId)) { found.siteIds.add(m[1]); hits++; }
  for (const m of r.text.matchAll(PATTERNS.apiBase)) { found.apiBases.add(m[0]); hits++; }
  if (hits === 0) console.log(`  (aucun signal)`);
}

console.log('\n═══ RECAP ═══');
console.log(`Technologies : ${[...found.techs].join(', ') || 'aucune'}`);
console.log(`SWARM URLs   : ${[...found.swarmUrls].join(', ') || 'aucune'}`);
console.log(`Site IDs     : ${[...found.siteIds].join(', ') || 'aucun'}`);
console.log(`API bases    : ${[...found.apiBases].slice(0, 10).join(', ') || 'aucune'}`);

// ═══════════════════════════════════════════════════════════════
// 3) Test SWARM avec site_ids candidats (BetMomo=122, MaxiBet=?)
// ═══════════════════════════════════════════════════════════════
const swarmUrl = process.env.MAXIBET_SWARM_URL || [...found.swarmUrls][0] || 'wss://eu-swarm-newm.betconstruct.com/';
const siteIdCandidates = [
  ...(process.env.MAXIBET_SITE_ID ? [process.env.MAXIBET_SITE_ID] : []),
  ...found.siteIds,
  // Enumeration ciblee : African operators BetConstruct connus
  '122', // BetMomo Congo
  '999', '1000', '1001', '1500', '2000', '2500', '3000',
];

console.log(`\n═══ 3) SWARM CONNECT TESTS (${swarmUrl}) ═══`);
for (const siteId of siteIdCandidates.slice(0, 12)) {
  const ok = await testSwarm(swarmUrl, Number(siteId));
  if (ok) {
    console.log(`  ✅ SUCCESS site_id=${siteId} → dumping sports list`);
    await dumpSports(swarmUrl, Number(siteId));
    break;
  }
}

async function testSwarm(url, siteId, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let ws;
    try { ws = new WebSocket(url); } catch { return resolve(false); }
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { ws.close(); } catch { /* ignore */ } resolve(v); };
    const t = setTimeout(() => finish(false), timeoutMs);
    ws.on('open', () => ws.send(JSON.stringify({ command: 'request_session', params: { site_id: siteId, language: 'eng' }, rid: 's1' })));
    ws.on('message', (raw) => {
      try {
        const m = JSON.parse(raw.toString());
        if (m.rid === 's1') {
          clearTimeout(t);
          const hasSid = !!m?.data?.sid;
          console.log(`  site_id=${siteId} → ${hasSid ? '✅ sid=' + m.data.sid : '❌ ' + (m?.data?.details || 'no sid')}`);
          finish(hasSid);
        }
      } catch { /* ignore */ }
    });
    ws.on('error', () => { clearTimeout(t); finish(false); });
    ws.on('close', () => { clearTimeout(t); finish(false); });
  });
}

async function dumpSports(url, siteId) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let ridN = 0; const pending = {};
    const send = (what, where) => new Promise((res) => {
      const rid = 'r' + (++ridN);
      pending[rid] = res;
      ws.send(JSON.stringify({ command: 'get', params: { source: 'betting', what, where }, rid }));
    });
    ws.on('open', () => ws.send(JSON.stringify({ command: 'request_session', params: { site_id: siteId, language: 'eng' }, rid: 's1' })));
    ws.on('message', async (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.rid === 's1') {
        // Fetch sports
        const sports = await send({ sport: ['id', 'name', 'alias'] }, { sport: {} });
        console.log('  Sports disponibles :');
        for (const s of Object.values(sports?.sport || {})) console.log(`    id=${s.id} ${s.name} (alias=${s.alias})`);
        // Fetch sample football match
        const foot = Object.values(sports?.sport || {}).find(s => /soccer|football/i.test(s.alias || s.name));
        if (foot) {
          const games = await send(
            { sport: ['id'], region: ['name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'start_ts'] },
            { sport: { id: foot.id }, game: { start_ts: { '@gt': Math.floor(Date.now() / 1000) }, is_live: 0 } },
          );
          let count = 0;
          for (const sp of Object.values(games?.sport || {})) {
            for (const rg of Object.values(sp.region || {})) {
              for (const cp of Object.values(rg.competition || {})) {
                for (const g of Object.values(cp.competition_game || cp.game || {})) {
                  count++;
                  if (count <= 5) console.log(`    ${g.team1_name} vs ${g.team2_name} [${cp.name}] start=${new Date(g.start_ts * 1000).toISOString()}`);
                }
              }
            }
          }
          console.log(`  Total matchs foot pre-match : ${count}`);
        }
        try { ws.close(); } catch { /* ignore */ }
        resolve();
      } else if (pending[m.rid]) {
        pending[m.rid](m?.data?.data);
        delete pending[m.rid];
      }
    });
    ws.on('error', () => resolve());
    ws.on('close', () => resolve());
    setTimeout(() => { try { ws.close(); } catch { /* ignore */ } resolve(); }, 15000);
  });
}
