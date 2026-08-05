#!/usr/bin/env node
// Probe Maxibet v3 — Jina en mode HTML brut + dump complet session SWARM.
import WebSocket from 'ws';

const HOSTS = ['https://m.maxibet.bet/', 'https://www.maxibet.bet/'];
const JINA = process.env.JINA_API_KEY || '';

async function fetchJinaHtml(url) {
  try {
    const r = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Authorization: JINA ? `Bearer ${JINA}` : '',
        'X-Return-Format': 'html',
        'X-Respond-With': 'html',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(25000),
    });
    return { status: r.status, text: r.ok ? await r.text() : '' };
  } catch (e) { return { status: 0, err: e.message, text: '' }; }
}

console.log('═══ 1) HTML BRUT via Jina ═══');
let bestHtml = '';
for (const host of HOSTS) {
  const r = await fetchJinaHtml(host);
  console.log(`${host} → status=${r.status} bytes=${r.text.length}${r.err ? ' err='+r.err : ''}`);
  if (r.text.length > bestHtml.length) bestHtml = r.text;
}

const PATTERNS = {
  betconstruct: /betconstruct|swarm|springbme|spring-bme/i,
  digitain: /digitain|dgtn/i,
  sbtech: /sbtech|sbstack/i,
  altenar: /altenar/i,
  swarmUrl: /wss?:\/\/[a-zA-Z0-9.-]*swarm[a-zA-Z0-9.-]*[a-zA-Z0-9\/._?=&-]*/gi,
  siteId: /["']?site[_-]?id["']?\s*[:=]\s*["']?(\d{2,7})/gi,
  partnerId: /["']?partner[_-]?id["']?\s*[:=]\s*["']?(\d{2,7})/gi,
  siteIdConst: /siteId\s*[:=]\s*(\d{2,7})/gi,
  apiBase: /https?:\/\/[a-z0-9.-]*maxibet\.bet[a-zA-Z0-9\/._?=&-]*/gi,
  scripts: /<script[^>]+src=["']([^"']+)["']/gi,
  betconstructUrl: /https?:\/\/[a-zA-Z0-9.-]*(betconstruct|springbme)\.com[a-zA-Z0-9\/._?=&-]*/gi,
  hostConfig: /(?:swarm|api|websocket|ws)[\s.:=]+["'`]([a-z0-9.-]+\.(?:betconstruct|springbme|maxibet)\.[a-z]+)/gi,
};

const found = { techs: [], swarmUrls: new Set(), siteIds: new Set(), partnerIds: new Set(), apiBases: new Set(), scripts: new Set(), bcUrls: new Set(), hosts: new Set() };
function analyze(text, label) {
  const before = { s: found.swarmUrls.size, si: found.siteIds.size, pi: found.partnerIds.size, sc: found.scripts.size, api: found.apiBases.size };
  for (const [tech, pat] of Object.entries({
    betconstruct: PATTERNS.betconstruct, digitain: PATTERNS.digitain, sbtech: PATTERNS.sbtech, altenar: PATTERNS.altenar,
  })) {
    if (pat.test(text)) found.techs.push(`${tech}(${label})`);
  }
  for (const m of text.matchAll(PATTERNS.swarmUrl)) found.swarmUrls.add(m[0]);
  for (const m of text.matchAll(PATTERNS.siteId)) found.siteIds.add(m[1]);
  for (const m of text.matchAll(PATTERNS.partnerId)) found.partnerIds.add(m[1]);
  for (const m of text.matchAll(PATTERNS.siteIdConst)) found.siteIds.add(m[1]);
  for (const m of text.matchAll(PATTERNS.apiBase)) found.apiBases.add(m[0]);
  for (const m of text.matchAll(PATTERNS.scripts)) found.scripts.add(m[1]);
  for (const m of text.matchAll(PATTERNS.betconstructUrl)) found.bcUrls.add(m[0]);
  for (const m of text.matchAll(PATTERNS.hostConfig)) found.hosts.add(m[1]);
  const after = { s: found.swarmUrls.size, si: found.siteIds.size, pi: found.partnerIds.size, sc: found.scripts.size, api: found.apiBases.size };
  return Object.entries(after).map(([k,v]) => v>before[k] ? `${k}+${v-before[k]}` : null).filter(Boolean);
}

if (bestHtml) {
  const delta = analyze(bestHtml, 'html');
  console.log(`  analyze → ${delta.join(' ') || 'aucun signal'}`);
  console.log(`  head (600c): ${bestHtml.slice(0, 600).replace(/\s+/g,' ')}`);
  console.log(`  tail (400c): ${bestHtml.slice(-400).replace(/\s+/g,' ')}`);
}

console.log('\n═══ 2) SCRIPTS BUNDLES via Jina ═══');
const bundles = [...found.scripts].slice(0, 5);
console.log(`  ${bundles.length} scripts trouves`);
for (const src of bundles) {
  const url = src.startsWith('http') ? src : `https://m.maxibet.bet${src.startsWith('/') ? '' : '/'}${src}`;
  const r = await fetchJinaHtml(url);
  if (r.text.length > 200) {
    const delta = analyze(r.text, url.slice(-30));
    console.log(`  ${url} (${r.text.length}b) → ${delta.join(' ') || 'aucun'}`);
  }
}

console.log('\n═══ RECAP ═══');
console.log(`Techs: ${found.techs.join(', ') || 'aucun'}`);
console.log(`SWARM URLs: ${[...found.swarmUrls].join(', ') || 'aucun'}`);
console.log(`Site IDs candidats: ${[...found.siteIds].join(', ') || 'aucun'}`);
console.log(`Partner IDs: ${[...found.partnerIds].join(', ') || 'aucun'}`);
console.log(`API bases: ${[...found.apiBases].slice(0,10).join(', ') || 'aucun'}`);
console.log(`BC URLs: ${[...found.bcUrls].slice(0,10).join(', ') || 'aucun'}`);
console.log(`Hosts: ${[...found.hosts].slice(0,10).join(', ') || 'aucun'}`);

// ═══════════════════════════════════════════════════════════════
// 3) SWARM DUMP full session response — cherche partner in session data
// ═══════════════════════════════════════════════════════════════
const swarmUrl = process.env.MAXIBET_SWARM_URL || 'wss://eu-swarm-newm.betconstruct.com/';
console.log(`\n═══ 3) SWARM SESSION DUMP (${swarmUrl}) ═══`);

const testIds = [
  ...(process.env.MAXIBET_SITE_ID ? [Number(process.env.MAXIBET_SITE_ID)] : []),
  ...[...found.siteIds].map(Number),
  ...[...found.partnerIds].map(Number),
];
// Range enumeration (Africa cohort autour BetMomo=122)
for (let i = 100; i <= 200; i++) testIds.push(i);
const uniq = [...new Set(testIds.filter(x => Number.isFinite(x) && x > 0))].slice(0, 80);

let hitCount = 0;
for (const siteId of uniq) {
  const info = await probeSite(swarmUrl, siteId);
  if (info && info.match) {
    hitCount++;
    console.log(`  🎯 site_id=${siteId} MATCH MAXIBET`);
    console.log('     data: ' + JSON.stringify(info.data).slice(0, 800));
  }
  // Sinon on log seulement les session valides avec partner_id ou site_id extra
  else if (info?.partner || info?.currency) {
    console.log(`  site_id=${siteId} partner=${info.partner || '?'} currency=${info.currency || '?'} langs=${(info.languages||[]).slice(0,3).join(',')}`);
  }
}
if (hitCount === 0) console.log('  Aucun site_id ne matche "maxi" dans les 80 IDs testes.');

async function probeSite(url, siteId, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let ws;
    try { ws = new WebSocket(url); } catch { return resolve(null); }
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { ws.close(); } catch { /* ignore */ } resolve(v); };
    const t = setTimeout(() => finish(null), timeoutMs);
    ws.on('open', () => ws.send(JSON.stringify({ command: 'request_session', params: { site_id: siteId, language: 'eng' }, rid: 's1' })));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.rid !== 's1') return;
      clearTimeout(t);
      const data = m?.data || {};
      const dataStr = JSON.stringify(data).toLowerCase();
      const info = {
        sid: data.sid, data,
        match: /maxi.?bet|maxibet/i.test(dataStr),
        partner: data.partner_id || data.partner || data.settings?.partner_id,
        currency: data.settings?.currency,
        languages: data.settings?.languages,
      };
      finish(info);
    });
    ws.on('error', () => { clearTimeout(t); finish(null); });
    ws.on('close', () => { clearTimeout(t); finish(null); });
  });
}
