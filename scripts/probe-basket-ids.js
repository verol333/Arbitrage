#!/usr/bin/env node
// PROBE BASKET IDs v3 — scan étendu betmomo (sport.id 1-50) + betpawa (cat 1-5000)
import WebSocket from 'ws';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36';

async function fetchRaw(url, opts = {}) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, ...(opts.headers || {}) },
      method: opts.method || 'GET', body: opts.body,
      signal: AbortSignal.timeout(opts.timeout || 15_000),
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* ignore */ }
    return { status: r.status, text, json };
  } catch (e) { return { status: 0, err: e.message }; }
}

// BETMOMO — enumération sport.id 1-50 pour trouver TOUS les sports avec games
async function probeBetmomo() {
  console.log('\n─── BETMOMO ───');
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://eu-swarm-newm.betconstruct.com/');
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
        if (!m.data?.sid) { clearTimeout(hard); return finish(); }
        // Test large range INCLUANT is_live=true (basket très saisonnier prematch)
        const now = Math.floor(Date.now() / 1000);
        for (const sportId of [...Array(50).keys()].map(i => i + 1)) {
          const [pre, live] = await Promise.all([
            send('get', {
              source: 'betting',
              what: { game: ['id', 'team1_name', 'team2_name'] },
              where: { sport: { id: sportId }, game: { start_ts: { '@gt': now, '@lt': now + 604800 }, is_live: 0 } },
            }),
            send('get', {
              source: 'betting',
              what: { game: ['id', 'team1_name', 'team2_name'] },
              where: { sport: { id: sportId }, game: { is_live: 1 } },
            }),
          ]);
          const count = (data) => {
            let n = 0; const samples = [];
            for (const s of Object.values(data?.data?.sport || {})) {
              for (const r of Object.values(s.region || {})) {
                for (const c of Object.values(r.competition || {})) {
                  for (const g of Object.values(c.game || {})) {
                    n++; if (samples.length < 1) samples.push(`${g.team1_name} vs ${g.team2_name}`);
                  }
                }
              }
            }
            return { n, samples };
          };
          const p = count(pre); const l = count(live);
          if (p.n > 0 || l.n > 0) {
            const samples = [...p.samples, ...l.samples].slice(0, 2);
            const isBasket = samples.some(s => /NBA|WNBA|Basket|BBL|Euroleague|Warriors|Lakers|Bulls|Heat|Celtics/i.test(s));
            console.log(`  sport.id=${sportId} → pre:${p.n} live:${l.n} | ${samples.join(' | ')}${isBasket ? '  ← ✅ BASKETBALL' : ''}`);
          }
        }
        clearTimeout(hard); finish();
      } else if (pending[m.rid]) { pending[m.rid](m); delete pending[m.rid]; }
    });
  });
}

// BETPAWA — dump menu sport-groups avec nom
async function probeBetpawa() {
  console.log('\n─── BETPAWA ───');
  // Endpoint menu qui liste TOUS les sports avec leurs categoryId
  const HDR = {
    Accept: 'application/json, text/plain, */*',
    'x-pawa-brand': 'betpawa-congobrazzaville',
    'x-pawa-language': 'fr',
    Referer: 'https://cg.betpawa.com/',
    Cookie: 'bp_country=CG',
  };
  // Tester plusieurs endpoints qui listent les catégories
  const urls = [
    'https://cg.betpawa.com/api/sportsbook/v4/categories',
    'https://cg.betpawa.com/api/sportsbook/v3/categories',
    'https://cg.betpawa.com/api/sportsbook/v4/navigation',
    'https://cg.betpawa.com/api/sportsbook/v4/menu',
    'https://cg.betpawa.com/api/sportsbook/v4/sports',
  ];
  for (const url of urls) {
    const r = await fetchRaw(url, { headers: HDR });
    if (r.status === 200 && r.text.length > 100) {
      console.log(`  ✅ ${url} → HTTP 200 (${r.text.length} bytes)`);
      // Chercher basket dans la réponse
      const basketMatches = r.text.match(/["']?(id|categoryId)["']?\s*:\s*["']?(\d+)["']?[^}]*basket[a-z]*/gi);
      if (basketMatches) {
        console.log(`     basket refs: ${basketMatches.slice(0, 3).join(' | ')}`);
      }
      // Dump snippet contenant "basket"
      const idx = r.text.toLowerCase().indexOf('basket');
      if (idx >= 0) {
        const start = Math.max(0, idx - 100);
        const end = Math.min(r.text.length, idx + 200);
        console.log(`     context: ${r.text.slice(start, end).replace(/\s+/g, ' ')}`);
      } else {
        console.log(`     no "basket" string found`);
      }
      break;
    } else {
      console.log(`  ${url} → HTTP ${r.status}`);
    }
  }
}

console.log('▶ PROBE BASKET IDs v3\n');
try { await probeBetmomo(); } catch (e) { console.log('ERR bm:', e.message); }
try { await probeBetpawa(); } catch (e) { console.log('ERR bp:', e.message); }
console.log('\n═══ FIN ═══');
