#!/usr/bin/env node
// PROBE BASKET IDs v2 — betmomo + betpawa uniquement (1xbet/1win/sb déjà OK)
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
// BETMOMO — tester sport.id={2,3,4} directement pour trouver basket
// ═══════════════════════════════════════════════════════════════
async function probeBetmomo() {
  console.log('\n─── BETMOMO ───');
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://eu-swarm-newm.betconstruct.com/');
    let done = false;
    const finish = () => { if (done) return; done = true; try { ws.close(); } catch { /* ignore */ } resolve(); };
    const hard = setTimeout(finish, 25_000);
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
        // Tester sport.id 2..10 en récupérant games directement
        const now = Math.floor(Date.now() / 1000);
        for (const sportId of [2, 3, 4, 5, 6, 7]) {
          const games = await send('get', {
            source: 'betting',
            what: { game: ['id', 'team1_name', 'team2_name'], competition: ['name'] },
            where: {
              sport: { id: sportId },
              game: { start_ts: { '@gt': now, '@lt': now + 172800 }, is_live: 0 },
            },
          });
          let count = 0; const samples = [];
          for (const s of Object.values(games?.data?.sport || {})) {
            for (const r of Object.values(s.region || {})) {
              for (const c of Object.values(r.competition || {})) {
                for (const g of Object.values(c.game || {})) {
                  count++;
                  if (samples.length < 2) samples.push(`${g.team1_name} vs ${g.team2_name} [${c.name || '?'}]`);
                }
              }
            }
          }
          if (count > 0) {
            const isBasket = samples.some(s => /NBA|WNBA|Basket|BBL|VTB|Euroleague/i.test(s));
            console.log(`  sport.id=${sportId} → ${count} games`);
            console.log(`    samples: ${samples.join(' | ')}`);
            if (isBasket) console.log(`    ✅ BASKETBALL sport.id=${sportId} confirmé`);
          } else {
            console.log(`  sport.id=${sportId} → 0 games`);
          }
        }
        clearTimeout(hard); finish();
      } else if (pending[m.rid]) { pending[m.rid](m); delete pending[m.rid]; }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// BETPAWA — scan catIds plus large + logique dump
// ═══════════════════════════════════════════════════════════════
async function probeBetpawa() {
  console.log('\n─── BETPAWA ───');
  const HDR = {
    Accept: 'application/x-protobuf',
    'x-pawa-brand': 'betpawa-congobrazzaville',
    'x-pawa-language': 'fr',
    Referer: 'https://cg.betpawa.com/events',
    Cookie: 'bp_country=CG',
  };
  // Scan cat 1-100 + quelques cat "high" typiques
  const candidates = [];
  for (let i = 1; i <= 100; i++) candidates.push(i);
  candidates.push(...[150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000]);

  for (const catId of candidates) {
    const q = { queries: [{ query: { eventType: 'UPCOMING', categories: [String(catId)], zones: {}, hasOdds: true }, view: { marketTypes: [] }, skip: 0, take: 3 }] };
    const url = `https://cg.betpawa.com/api/sportsbook/v4/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`;
    const r = await fetchRaw(url, { headers: HDR });
    if (r.status !== 200 || !r.text) continue;
    const buf = Buffer.from(r.text, 'binary');
    const strings = [];
    let cur = '';
    for (const b of buf) {
      if (b >= 32 && b <= 126) cur += String.fromCharCode(b);
      else { if (cur.length > 2) strings.push(cur); cur = ''; }
    }
    // Extraire les strings qui ressemblent à des noms d'events (X - Y)
    const eventNames = strings.filter(s => / - /.test(s) && s.length > 10 && s.length < 100);
    if (eventNames.length === 0) continue;
    const hasBasket = eventNames.some(n => /NBA|NCAA|WNBA|Basket|BBL|VTB|Euroleague/i.test(n));
    // Loguer uniquement les cats qui ont des events (skip cats vides)
    if (hasBasket) {
      console.log(`  ✅ cat=${catId} → BASKET : ${eventNames.slice(0, 3).join(' | ').slice(0, 200)}`);
      return;
    }
    // Log tous les non-vides pour debug si aucun basket trouvé
    if (candidates.indexOf(catId) < 20 || eventNames.length > 0) {
      // Skip log si event ressemble à foot/tennis pour ne pas polluer
      const first = eventNames[0].slice(0, 60);
      if (!/vs|women|(w)|womens/i.test(first) || Math.random() < 0.1) {
        console.log(`    cat=${catId} → ${eventNames.length} events : ${first}`);
      }
    }
  }
  console.log(`  ⚠️ Aucun catId 1-1000 n'a matché basket évident`);
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
console.log('▶ PROBE BASKET IDs v2 — betmomo + betpawa\n');
console.log('  Déjà confirmés :');
console.log('    1win     : sportId=23');
console.log('    sportybet: sr:sport:2');
console.log('    1xbet    : sports=3');
try { await probeBetmomo(); } catch (e) { console.log('  ERR betmomo:', e.message); }
try { await probeBetpawa(); } catch (e) { console.log('  ERR betpawa:', e.message); }
console.log('\n═══ FIN ═══');
