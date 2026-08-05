#!/usr/bin/env node
// Probe Maxibet v2 — tente plusieurs proxies (CF Worker, Jina, direct) car
// m.maxibet.bet est geo-bloque (Cameroon/Gabon only). Enumeration site_ids
// BetConstruct SWARM et dump partner detail pour trouver Maxibet's site_id.
import WebSocket from 'ws';

const HOSTS = [
  'https://m.maxibet.bet/',
  'https://www.maxibet.bet/',
];

const CF = process.env.CF_WORKER_PROXY_URL || '';
const JINA = process.env.JINA_API_KEY || '';

async function fetchDirect(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone) Safari' }, signal: AbortSignal.timeout(15000) });
    return { status: r.status, text: r.ok ? await r.text() : '' };
  } catch (e) { return { status: 0, err: e.message, text: '' }; }
}
async function fetchCF(url) {
  if (!CF) return { status: -1, text: '' };
  try {
    const r = await fetch(`${CF}/?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(25000) });
    return { status: r.status, text: r.ok ? await r.text() : '' };
  } catch (e) { return { status: 0, err: e.message, text: '' }; }
}
async function fetchJina(url) {
  try {
    const r = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Authorization: JINA ? `Bearer ${JINA}` : '', 'X-Return-Format': 'text' },
      signal: AbortSignal.timeout(25000),
    });
    return { status: r.status, text: r.ok ? await r.text() : '' };
  } catch (e) { return { status: 0, err: e.message, text: '' }; }
}

console.log('═══ 1) HOMEPAGE FETCH — 3 modes ═══');
let bestHtml = '';
for (const host of HOSTS) {
  console.log(`\n▶ ${host}`);
  for (const [name, fn] of [['direct', fetchDirect], ['cfworker', fetchCF], ['jina', fetchJina]]) {
    const r = await fn(host);
    console.log(`  ${name} → status=${r.status} bytes=${r.text.length}${r.err ? ' err=' + r.err : ''}`);
    if (r.text.length > bestHtml.length) bestHtml = r.text;
  }
}

const PATTERNS = {
  betconstruct: /betconstruct|swarm|springbme|spring-bme|sb-front-office/i,
  digitain: /digitain|dgtn/i,
  sbtech: /sbtech|sbstack/i,
  altenar: /altenar/i,
  playtech: /playtech|iflex/i,
  swarmUrl: /wss?:\/\/[a-z0-9.-]*swarm[a-z0-9.-]*\.[a-z]+[^"'\s)]*/gi,
  siteId: /"?site[_-]?id"?[\s:=]+["']?(\d{2,6})/gi,
  partnerId: /"?partner[_-]?id"?[\s:=]+["']?(\d{2,6})/gi,
  apiBase: /https?:\/\/[a-z0-9.-]+\.maxibet\.bet[a-z0-9\/._-]*/gi,
  cdnAssets: /https?:\/\/[a-z0-9.-]+\.(cloudfront\.net|amazonaws\.com|betconstruct\.com|springbme\.com)[a-z0-9\/._-]*/gi,
};

const found = { techs: new Set(), swarmUrls: new Set(), siteIds: new Set(), partnerIds: new Set(), apiBases: new Set(), cdns: new Set(), scripts: new Set() };
function analyze(text) {
  for (const [tech, pat] of Object.entries(PATTERNS)) {
    if (['swarmUrl','siteId','partnerId','apiBase','cdnAssets'].includes(tech)) continue;
    if (pat.test(text)) found.techs.add(tech);
  }
  for (const m of text.matchAll(PATTERNS.swarmUrl)) found.swarmUrls.add(m[0]);
  for (const m of text.matchAll(PATTERNS.siteId)) found.siteIds.add(m[1]);
  for (const m of text.matchAll(PATTERNS.partnerId)) found.partnerIds.add(m[1]);
  for (const m of text.matchAll(PATTERNS.apiBase)) found.apiBases.add(m[0]);
  for (const m of text.matchAll(PATTERNS.cdnAssets)) found.cdns.add(m[0]);
  for (const m of text.matchAll(/<script[^>]+src="([^"]+)"/gi)) found.scripts.add(m[1]);
}
if (bestHtml) analyze(bestHtml);

console.log(`\n▶ Best HTML captured: ${bestHtml.length} bytes`);
if (bestHtml.length > 0) console.log('  Preview (first 800 chars):\n' + bestHtml.slice(0, 800).replace(/\s+/g, ' '));

// Fetch bundles via CF si possible
console.log('\n═══ 2) SCRIPTS BUNDLES via CF ═══');
for (const src of [...found.scripts].slice(0, 8)) {
  const url = src.startsWith('http') ? src : `https://m.maxibet.bet${src.startsWith('/') ? '' : '/'}${src}`;
  const r = await fetchCF(url);
  if (r.text && r.text.length > 500) {
    console.log(`▶ ${url} (${r.text.length}b)`);
    const before = found.techs.size + found.swarmUrls.size + found.siteIds.size + found.partnerIds.size;
    analyze(r.text);
    const after = found.techs.size + found.swarmUrls.size + found.siteIds.size + found.partnerIds.size;
    if (after > before) console.log(`  +${after - before} new signals`);
  }
}

console.log('\n═══ RECAP ═══');
console.log(`Techs      : ${[...found.techs].join(', ') || 'aucune'}`);
console.log(`SWARM URLs : ${[...found.swarmUrls].join(', ') || 'aucune'}`);
console.log(`Site IDs   : ${[...found.siteIds].join(', ') || 'aucun'}`);
console.log(`Partner IDs: ${[...found.partnerIds].join(', ') || 'aucun'}`);
console.log(`API bases  : ${[...found.apiBases].slice(0, 5).join(', ') || 'aucune'}`);
console.log(`CDNs       : ${[...found.cdns].slice(0, 5).join(', ') || 'aucune'}`);

// ═══════════════════════════════════════════════════════════════
// 3) ENUMERATION SITE_IDS BetConstruct SWARM — dump partner detail
// Site_ids africains connus : BetMomo=122. Test 100-500 pour trouver Maxibet.
// ═══════════════════════════════════════════════════════════════
const swarmUrl = process.env.MAXIBET_SWARM_URL || [...found.swarmUrls][0] || 'wss://eu-swarm-newm.betconstruct.com/';
console.log(`\n═══ 3) SWARM PARTNER DETAIL (${swarmUrl}) ═══`);

const candidateIds = [
  ...(process.env.MAXIBET_SITE_ID ? [Number(process.env.MAXIBET_SITE_ID)] : []),
  ...[...found.siteIds].map(Number),
  ...[...found.partnerIds].map(Number),
];
// Enumeration ciblee : range africains connus autour BetMomo=122
const enumRanges = [
  [100, 130], [150, 200], [1000, 1010], [1500, 1510], [2000, 2010],
];
for (const [start, end] of enumRanges) {
  for (let i = start; i <= end; i++) candidateIds.push(i);
}
const uniq = [...new Set(candidateIds.filter(x => Number.isFinite(x) && x > 0))];

for (const siteId of uniq.slice(0, 60)) {
  const info = await probeSite(swarmUrl, siteId);
  if (info) {
    const nameHit = /maxi|max.?bet/i.test(JSON.stringify(info));
    console.log(`  site_id=${siteId} sid=${info.sid || '?'} title="${(info.title || '').slice(0,40)}" partner=${info.partner_id || '?'}${nameHit ? '  ← 🎯 MAXIBET?' : ''}`);
    if (nameHit) {
      console.log('    FULL info:', JSON.stringify(info).slice(0, 500));
    }
  }
}

async function probeSite(url, siteId, timeoutMs = 6000) {
  return new Promise((resolve) => {
    let ws;
    try { ws = new WebSocket(url); } catch { return resolve(null); }
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { ws.close(); } catch { /* ignore */ } resolve(v); };
    const t = setTimeout(() => finish(null), timeoutMs);
    let ridN = 0; const pending = {};
    const send = (cmd, params) => new Promise((res) => {
      const rid = 'r' + (++ridN);
      pending[rid] = res;
      ws.send(JSON.stringify({ command: cmd, params, rid }));
    });
    ws.on('open', () => ws.send(JSON.stringify({ command: 'request_session', params: { site_id: siteId, language: 'eng' }, rid: 's1' })));
    ws.on('message', async (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.rid === 's1') {
        const sid = m?.data?.sid;
        if (!sid) { clearTimeout(t); return finish(null); }
        // Tente get_swarm_state pour recuperer partner info
        const st = await send('get', { source: 'partner', what: { partner: [] } });
        // Aussi essaie system_state
        const info = { sid, site_id: siteId };
        const partners = st?.data?.partner || {};
        for (const [pid, p] of Object.entries(partners)) {
          info.partner_id = pid;
          info.title = p?.name || p?.title || '';
          if (p?.name) info.name = p.name;
        }
        clearTimeout(t); finish(info);
      } else if (pending[m.rid]) {
        pending[m.rid](m?.data);
        delete pending[m.rid];
      }
    });
    ws.on('error', () => { clearTimeout(t); finish(null); });
    ws.on('close', () => { clearTimeout(t); finish(null); });
  });
}
