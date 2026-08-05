#!/usr/bin/env node
// Probe Maxibet v6 — Maxibet CONFIRME BetConstruct via cms.maxibet.bet.
// Trouve le site_id via (a) fetch CMS bundle, (b) enum tres large SWARM ids.
import WebSocket from 'ws';

const JINA = process.env.JINA_API_KEY || '';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchJina(url) {
  try {
    const r = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Authorization: JINA ? `Bearer ${JINA}` : '', 'X-Return-Format': 'html', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(30000),
    });
    return { status: r.status, text: r.ok ? await r.text() : '' };
  } catch (e) { return { status: 0, err: e.message, text: '' }; }
}

// ═══════════════════════════════════════════════════════════════
// 1) CMS bundle — BetConstruct CMS a une config avec site_id
// ═══════════════════════════════════════════════════════════════
console.log('═══ 1) CMS BetConstruct bundle ═══');
const cmsHome = await fetchJina('https://cms.maxibet.bet/');
const cmsScripts = [...cmsHome.text.matchAll(/src=["']([^"']+\.js[^"']*)["']/gi)].map(m => m[1]);
console.log(`CMS scripts: ${cmsScripts.join(', ')}`);
await sleep(3000);
for (const s of cmsScripts.slice(0, 3)) {
  const url = s.startsWith('http') ? s : `https://cms.maxibet.bet/${s.replace(/^\//, '')}`;
  const r = await fetchJina(url);
  console.log(`${url} → ${r.status} ${r.text.length}b`);
  if (r.text.length > 500) {
    // Grep site_id, partner_id, swarm URL, apiUrl
    for (const [label, pat] of [
      ['site_id', /site[_-]?id[\s:=]+["']?(\d{2,7})/gi],
      ['partner_id', /partner[_-]?id[\s:=]+["']?(\d{2,7})/gi],
      ['SWARM_URL', /wss?:\/\/[a-z0-9.-]+swarm[a-z0-9.-]*[a-z0-9\/._?=&-]*/gi],
      ['betconstruct_url', /https?:\/\/[a-z0-9.-]+betconstruct\.com[a-z0-9\/._?=&-]*/gi],
      ['apiUrl', /apiUrl[\s:=]+["']([^"']+)["']/gi],
      ['baseUrl', /baseUrl[\s:=]+["']([^"']+)["']/gi],
      ['api_url', /["']api[_-]?url["'][\s:=]+["']([^"']+)["']/gi],
      ['siteConfig', /siteConfig[\s:=]+({[^}]*})/gi],
    ]) {
      const found = [...new Set([...r.text.matchAll(pat)].map(m => m[0]))].slice(0, 8);
      if (found.length) {
        console.log(`  ${label}:`);
        for (const f of found) console.log(`    ${f.slice(0, 200)}`);
      }
    }
    // Aussi dump les 1500 premiers chars
    console.log('  head:', r.text.slice(0, 1500).replace(/\s+/g, ' ').slice(0, 1500));
  }
  await sleep(3000);
}

// ═══════════════════════════════════════════════════════════════
// 2) SWARM enum tres large + multi-endpoints
// ═══════════════════════════════════════════════════════════════
const swarmUrls = [
  'wss://eu-swarm-newm.betconstruct.com/',
  'wss://eu-swarm.betconstruct.com/',
  'wss://eu-swarm-ws.betconstruct.com/',
];

// Site_ids : 1-500 (enum dense) + 1000-1500 + 5000-5100
const ids = [];
for (let i = 1; i <= 500; i++) ids.push(i);
for (let i = 1000; i <= 1200; i++) ids.push(i);
for (let i = 5000; i <= 5100; i++) ids.push(i);

for (const swarmUrl of swarmUrls) {
  console.log(`\n═══ SWARM ENUM: ${swarmUrl} ═══`);
  // Test parallel batches de 20
  const BATCH = 20;
  let totalHits = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(id => probeSite(swarmUrl, id, 4000)));
    for (let j = 0; j < batch.length; j++) {
      const info = results[j];
      if (info && info.match) {
        totalHits++;
        console.log(`  🎯 site_id=${batch[j]} MATCH → ${JSON.stringify(info.data).slice(0, 500)}`);
      }
    }
    // Progress log tous les 100
    if ((i + BATCH) % 100 === 0) process.stdout.write(`    tested up to ${i + BATCH}\n`);
    if (totalHits >= 3) break; // Enough
  }
  if (totalHits === 0) console.log(`  aucun match "maxi" sur ${ids.length} ids testes.`);
}

async function probeSite(url, siteId, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let ws;
    try { ws = new WebSocket(url); } catch { return resolve(null); }
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { ws.close(); } catch {} resolve(v); };
    const t = setTimeout(() => finish(null), timeoutMs);
    ws.on('open', () => ws.send(JSON.stringify({ command: 'request_session', params: { site_id: siteId, language: 'eng' }, rid: 's1' })));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.rid !== 's1') return;
      clearTimeout(t);
      const data = m?.data || {};
      const dataStr = JSON.stringify(data).toLowerCase();
      finish({ sid: data.sid, data, match: /maxibet|maxi.?bet/.test(dataStr) });
    });
    ws.on('error', () => { clearTimeout(t); finish(null); });
    ws.on('close', () => { clearTimeout(t); finish(null); });
  });
}
