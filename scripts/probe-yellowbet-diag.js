// Diag YellowBet : pourquoi 0 matches ?
import { stealthGetJson } from '../src/net/stealth.js';
import { fetchJson } from '../src/net/fetcher.js';
const H = { brandid: '122', channelid: '4', language: 'fr', terminal: 'yellowbet.cg' };
const url = 'https://yellowbet.cg/services/evapi/event/GetEvents?fromDate=' + new Date().toISOString().replace(/\.\d{3}Z$/,'Z') + '&toDate=' + new Date(Date.now()+72*3600*1000).toISOString().replace(/\.\d{3}Z$/,'Z') + '&skip=0&take=500&count=500&pageSize=500';
console.log('URL:', url);
console.log('--- stealth ---');
const t0 = Date.now();
try { const j = await stealthGetJson(url, { headers: H, timeoutMs: 15000 }); console.log('stealth ok, elapsed', Date.now()-t0, 'keys:', Object.keys(j||{}), 'data.len:', j?.data?.length); }
catch (e) { console.log('stealth err', e.message); }
console.log('--- direct fetchJson ---');
const t1 = Date.now();
try { const j = await fetchJson(url, { headers: H, timeoutMs: 20000 }); console.log('direct ok, elapsed', Date.now()-t1, 'keys:', Object.keys(j||{}), 'data.len:', j?.data?.length); }
catch (e) { console.log('direct err', e.message); }
console.log('--- raw fetch ---');
try { const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(15000) }); const b = await r.text(); console.log('status', r.status, 'len', b.length, 'start', b.slice(0,300)); }
catch (e) { console.log('raw err', e.message); }
process.exit(0);
