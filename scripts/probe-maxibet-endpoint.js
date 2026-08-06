#!/usr/bin/env node
// Probe Maxibet v8 — enum site_ids avec bon chemin (partner_config.currency).
// Maxibet opere au Cameroun/Gabon → currency=XAF (Franc CFA BEAC).
// Egalement collecte tous les operateurs BetConstruct avec devise africaine
// pour trouver un "sister site" mirror (comme premierbet/guineegames).
import WebSocket from 'ws';

const SWARM = 'wss://eu-swarm-newm.betconstruct.com/';
// XAF = Cameroon, Gabon, Chad, Congo Brazza (BEAC franc)
// XOF = Cotes, Senegal, Mali, Burkina (BCEAO franc)
// NGN, ZAR, KES, GHS, TZS = autres africains
const AFRICAN_CCY = new Set(['XAF', 'XOF', 'NGN', 'ZAR', 'KES', 'GHS', 'TZS', 'UGX', 'RWF', 'ETB', 'MAD', 'DZD', 'TND', 'EGP', 'SLL', 'MZN', 'AOA']);

async function probeSite(siteId, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let ws;
    try { ws = new WebSocket(SWARM); } catch { return resolve(null); }
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { ws.close(); } catch {} resolve(v); };
    const t = setTimeout(() => finish(null), timeoutMs);
    ws.on('open', () => ws.send(JSON.stringify({ command: 'request_session', params: { site_id: siteId, language: 'eng' }, rid: 's1' })));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.rid !== 's1') return;
      clearTimeout(t);
      const d = m?.data || {};
      const pc = d.partner_config || {};
      finish({
        siteId,
        sid: d.sid,
        partnerId: pc.partner_id || pc.id,
        currency: pc.currency,
        supportedCurrencies: pc.supported_currencies || [],
        maxPayout: pc.max_payout,
      });
    });
    ws.on('error', () => { clearTimeout(t); finish(null); });
    ws.on('close', () => { clearTimeout(t); finish(null); });
  });
}

// 1) Enum 1-2500 par batches paralleles, dump africains + XAF particulierement
console.log('═══ ENUM site_ids 1-2500 → filtre devises africaines ═══');
const IDS = [];
for (let i = 1; i <= 2500; i++) IDS.push(i);
const BATCH = 25;
const africans = [];
let total = 0;
for (let i = 0; i < IDS.length; i += BATCH) {
  const batch = IDS.slice(i, i + BATCH);
  const results = await Promise.all(batch.map(id => probeSite(id, 4000)));
  for (const r of results) {
    if (!r || !r.currency) continue;
    total++;
    const isAfrican = AFRICAN_CCY.has(r.currency);
    const supportedAfrican = (r.supportedCurrencies || []).some(c => AFRICAN_CCY.has(c));
    if (isAfrican || supportedAfrican) {
      africans.push(r);
      const marker = r.currency === 'XAF' ? '🎯 XAF (CM/GA/TD/CG)' : (r.currency === 'XOF' ? '🎯 XOF (CI/SN/ML/BF)' : `[${r.currency}]`);
      console.log(`  site_id=${r.siteId} partner=${r.partnerId} ccy=${r.currency} supp=${r.supportedCurrencies.join(',')} max=${r.maxPayout} ${marker}`);
    }
  }
  if ((i + BATCH) % 250 === 0) process.stdout.write(`  ... tested ${i + BATCH}/${IDS.length}, ${total} responded, ${africans.length} african\n`);
}

console.log(`\n═══ RECAP ═══`);
console.log(`Total responses: ${total}/${IDS.length}`);
console.log(`African operators: ${africans.length}`);
console.log(`XAF operators (CM/GA/TD/CG): ${africans.filter(a => a.currency === 'XAF').map(a => `site=${a.siteId}(partner=${a.partnerId})`).join(', ') || 'aucun'}`);
