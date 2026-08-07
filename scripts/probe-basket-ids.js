#!/usr/bin/env node
// PROBE BASKET IDs — identifie sportId basket sur 1xbet, betmomo, betpawa.
// 1win + sportybet deja confirmes via F12 user (1win=23, sportybet=sr:sport:2).
import WebSocket from 'ws';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36';

async function fetchRaw(url, opts = {}) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, ...(opts.headers || {}) },
      method: opts.method || 'GET',
      body: opts.body,
      signal: AbortSignal.timeout(opts.timeout || 15_000),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    return { status: r.status, text, json };
  } catch (e) {
    return { status: 0, err: e.message, text: '', json: null };
  }
}

// ═══════════════════════════════════════════════════════════════
// 1) 1XBET — test sports=3 via CF workers (megapari.africa miroir)
// ═══════════════════════════════════════════════════════════════
async function probe1xbet() {
  console.log('\n─── 1XBET ───');
  const candidates = [3, 4]; // convention 1xBet : 3 = Basketball
  for (const sportId of candidates) {
    const url = `https://megapari.africa/service-api/LineFeed/Get1x2_VZip?sports=${sportId}&count=30&lng=fr&mode=4&country=93&partner=192`;
    const r = await fetchRaw(url, {
      headers: {
        Origin: 'https://megapari.africa',
        Referer: 'https://megapari.africa/fr/line',
        'x-app-n': '__BETTING_APP__',
        'x-svc-source': '__BETTING_APP__',
      },
    });
    const evts = r.json?.Value || [];
    console.log(`  sports=${sportId} → HTTP ${r.status}, ${evts.length} events`);
    if (evts.length > 0) {
      const sample = evts.slice(0, 3).map(e => `${e.O1 || '?'} vs ${e.O2 || '?'} [${e.L || '?'}]`);
      console.log(`    samples: ${sample.join(' | ')}`);
      const isBasket = sample.some(s => /NBA|NCAA|Basket|BBL|VTB|Euroleague|WNBA/i.test(s));
      console.log(`    → ${isBasket ? '✅ BASKETBALL confirmé' : '⚠️ pas basket évident, à vérifier'}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 2) BETMOMO — SWARM query sport.id=3 (BetConstruct standard)
// ═══════════════════════════════════════════════════════════════
async function probeBetmomo() {
  console.log('\n─── BETMOMO ───');
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://eu-swarm-newm.betconstruct.com/');
    let done = false;
    const finish = () => { if (done) return; done = true; try { ws.close(); } catch { /* ignore */ } resolve(); };
    const hard = setTimeout(finish, 20_000);
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
        if (!m.data?.sid) { clearTimeout(hard); console.log('  no sid'); return finish(); }
        // Liste des sports avec games count
        const sports = await send('get', {
          source: 'betting',
          what: { sport: ['id', 'name', 'alias'] },
        });
        const sportsData = sports?.data?.sport || {};
        const list = Object.values(sportsData);
        console.log(`  ${list.length} sports découverts`);
        const basket = list.find(s => /basket/i.test(s.name || '') || /basket/i.test(s.alias || ''));
        if (basket) {
          console.log(`  ✅ BASKETBALL sport.id=${basket.id} (name="${basket.name}", alias="${basket.alias}")`);
          // Sample 2 games basket
          const now = Math.floor(Date.now() / 1000);
          const games = await send('get', {
            source: 'betting',
            what: { game: ['id', 'team1_name', 'team2_name', 'start_ts'] },
            where: { sport: { id: basket.id }, game: { start_ts: { '@gt': now, '@lt': now + 172800 }, is_live: 0 } },
          });
          let count = 0;
          for (const s of Object.values(games?.data?.sport || {})) {
            for (const r of Object.values(s.region || {})) {
              for (const c of Object.values(r.competition || {})) {
                for (const g of Object.values(c.game || {})) {
                  if (count++ < 3) console.log(`    sample: ${g.team1_name} vs ${g.team2_name}`);
                }
              }
            }
          }
          console.log(`    → ${count} games basket upcoming`);
        } else {
          console.log(`  ⚠️ pas de sport "basket" trouvé — liste : ${list.slice(0, 15).map(s => `${s.id}:${s.name}`).join(' | ')}`);
        }
        clearTimeout(hard); finish();
      } else if (pending[m.rid]) { pending[m.rid](m); delete pending[m.rid]; }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// 3) BETPAWA — teste candidates categoryIds pour basket
// ═══════════════════════════════════════════════════════════════
async function probeBetpawa() {
  console.log('\n─── BETPAWA ───');
  // Convention BetPawa : foot=2, tennis=452. Basket typiquement 3-10.
  const candidates = [3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 100, 200, 300, 453, 454];
  const HDR = {
    Accept: 'application/x-protobuf',
    'x-pawa-brand': 'betpawa-congobrazzaville',
    'x-pawa-language': 'fr',
    Referer: 'https://cg.betpawa.com/events',
    Cookie: 'bp_country=CG',
  };
  for (const catId of candidates) {
    const q = { queries: [{ query: { eventType: 'UPCOMING', categories: [String(catId)], zones: {}, hasOdds: true }, view: { marketTypes: [] }, skip: 0, take: 5 }] };
    const url = `https://cg.betpawa.com/api/sportsbook/v4/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`;
    const r = await fetchRaw(url, { headers: HDR });
    if (r.status !== 200) continue;
    const buf = Buffer.from(r.text, 'binary');
    // Extract ASCII strings
    const strings = [];
    let cur = '';
    for (const b of buf) {
      if (b >= 32 && b <= 126) cur += String.fromCharCode(b);
      else { if (cur.length > 2) strings.push(cur); cur = ''; }
    }
    const eventNames = strings.filter(s => s.includes(' - ') && s.length > 8 && s.length < 100);
    if (eventNames.length > 0) {
      const isBasket = eventNames.some(n => /NBA|NCAA|Basket|BBL|VTB|WNBA|Euroleague/i.test(n));
      console.log(`  cat=${catId} → ${eventNames.length} events : ${eventNames.slice(0, 2).join(' | ').slice(0, 150)}`);
      if (isBasket) {
        console.log(`    ✅ BASKETBALL categoryId=${catId} confirmé`);
        return;
      }
    }
  }
  console.log(`  ⚠️ Aucun catId testé n'a matché basket évident`);
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
console.log('▶ PROBE BASKET IDs — 1xbet, betmomo, betpawa\n');
console.log('  Déjà confirmés via F12 user :');
console.log('    1win     : sportId=23 (slug basketball)');
console.log('    sportybet: sr:sport:2');
try { await probe1xbet(); } catch (e) { console.log('  ERR 1xbet:', e.message); }
try { await probeBetmomo(); } catch (e) { console.log('  ERR betmomo:', e.message); }
try { await probeBetpawa(); } catch (e) { console.log('  ERR betpawa:', e.message); }
console.log('\n═══ FIN ═══');
