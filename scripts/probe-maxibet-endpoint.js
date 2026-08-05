#!/usr/bin/env node
// Probe Maxibet v7 — final : tente API publiques BetConstruct pour resolve
// site_id via domain lookup + dump session structure pour site_id=122 (BetMomo)
// afin de savoir quel champ chercher.
import WebSocket from 'ws';

const JINA = process.env.JINA_API_KEY || '';
async function fetchJina(url) {
  try {
    const r = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Authorization: JINA ? `Bearer ${JINA}` : '', 'X-Return-Format': 'html', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(30000),
    });
    return { status: r.status, text: r.ok ? await r.text() : '' };
  } catch (e) { return { status: 0, err: e.message, text: '' }; }
}
async function fetchDirect(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
    return { status: r.status, text: r.ok ? await r.text() : '' };
  } catch (e) { return { status: 0, err: e.message, text: '' }; }
}

// ═══════════════════════════════════════════════════════════════
// 1) Dump BetMomo session data (site_id=122) — structure de reference
// ═══════════════════════════════════════════════════════════════
console.log('═══ BetMomo session structure (ref) ═══');
const refData = await new Promise((resolve) => {
  const ws = new WebSocket('wss://eu-swarm-newm.betconstruct.com/');
  const t = setTimeout(() => { try { ws.close(); } catch {} resolve(null); }, 8000);
  ws.on('open', () => ws.send(JSON.stringify({ command: 'request_session', params: { site_id: 122, language: 'eng' }, rid: 's1' })));
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.rid === 's1') { clearTimeout(t); try { ws.close(); } catch {} resolve(m.data); }
  });
  ws.on('error', () => { clearTimeout(t); resolve(null); });
});
console.log(JSON.stringify(refData, null, 2).slice(0, 3000));

// ═══════════════════════════════════════════════════════════════
// 2) BetConstruct API : trouve site_id par host lookup
// ═══════════════════════════════════════════════════════════════
console.log('\n═══ BC public API lookups ═══');
const bcApis = [
  'https://eu-swarm-newm.betconstruct.com/api/config?url=m.maxibet.bet',
  'https://swarm-preview.betconstruct.com/api/site_info?site=maxibet',
  'https://cms.maxibet.bet/api/v1/site',
  'https://cms.maxibet.bet/api/config',
  'https://cms.maxibet.bet/api/getSiteByHost?host=m.maxibet.bet',
  'https://cms.maxibet.bet/build/js/main.js?version=19629',
  'https://m.maxibet.bet/config.js',
  'https://m.maxibet.bet/assets/config.json',
  // Skinning URL specific BetConstruct
  'https://static.maxibet.bet/skinning/skinning-variables.js',
  'https://cms.maxibet.bet/skinning/skinning-variables.js',
];
for (const url of bcApis) {
  // Try direct first (GH runner not geo-blocked from BetConstruct's own APIs)
  const r = await fetchDirect(url);
  console.log(`${url}\n  direct → ${r.status} ${r.text.length}b${r.err ? ' err='+r.err : ''}`);
  if (r.text && r.text.length > 100 && r.text.length < 20000) {
    // Grep site_id / partner_id
    const sid = [...r.text.matchAll(/site[_-]?id[\s:=]+["']?(\d{2,7})/gi)].map(m => m[1]);
    const pid = [...r.text.matchAll(/partner[_-]?id[\s:=]+["']?(\d{2,7})/gi)].map(m => m[1]);
    if (sid.length || pid.length) console.log(`    site_ids=${[...new Set(sid)]} partner_ids=${[...new Set(pid)]}`);
    console.log('    head:', r.text.slice(0, 400).replace(/\s+/g, ' '));
  }
}

// ═══════════════════════════════════════════════════════════════
// 3) Enum site_ids 500-5000 avec dump COMPLET premieres reponses
//    (peut-etre la reponse contient un domain/host)
// ═══════════════════════════════════════════════════════════════
console.log('\n═══ Dump session for site_ids around BetMomo cohort ═══');
const targets = [
  1, 100, 122, 130, 150, 200, 250, 300, 500, 800, 1000, 1500, 2000,
  // Africa cohort guess
  228, 253, 259, 371, 442, 480, 528, 587, 615, 653, 712, 800,
];
for (const siteId of targets) {
  const data = await new Promise((resolve) => {
    const ws = new WebSocket('wss://eu-swarm-newm.betconstruct.com/');
    const t = setTimeout(() => { try { ws.close(); } catch {} resolve(null); }, 5000);
    ws.on('open', () => ws.send(JSON.stringify({ command: 'request_session', params: { site_id: siteId, language: 'eng' }, rid: 's1' })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.rid === 's1') { clearTimeout(t); try { ws.close(); } catch {} resolve(m.data); }
    });
    ws.on('error', () => { clearTimeout(t); resolve(null); });
  });
  if (!data) { console.log(`  site_id=${siteId} timeout`); continue; }
  const str = JSON.stringify(data);
  const isMaxi = /maxibet|maxi.?bet/i.test(str);
  const currency = data?.settings?.currency || data?.currency;
  const langs = (data?.settings?.languages || []).slice(0, 3);
  console.log(`  site_id=${siteId} sid=${(data.sid||'').slice(0,8)} currency=${currency||'?'} langs=${langs.join(',')} ${isMaxi ? '🎯 MAXI' : ''}`);
  if (isMaxi) {
    console.log('     FULL: ' + str);
  }
}
