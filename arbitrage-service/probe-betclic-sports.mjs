// Sonde Betclic (via relais Base44) : pour tennis/basket/hockey/volley,
// liste les matchs (mode 'list') puis lit le 1er match (mode 'odds'). Le mode
// odds inclut la categorie "" (bouquet par defaut) qui marche pour TOUT sport :
// on obtient les marches principaux + leurs selections sans mode dedie.
const RELAY = 'https://al-ve-pro.base44.app/functions/betclicRelay';
const SECRET = process.env.WEBHOOK_SECRET || '';
const log = (m) => console.log(m);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function post(body, timeoutMs = 120000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try { const res = await fetch(RELAY, { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json', 'x-webhook-secret': SECRET }, body: JSON.stringify(body) }); return await res.json(); } catch (e) { return { error: e.message }; } finally { clearTimeout(t); }
}

async function probe(sport) {
  const lj = await post({ mode: 'list', sport });
  const matches = lj.matches || [];
  log('\n========================================');
  log('=== ' + sport.toUpperCase() + ' (' + matches.length + ' matchs) ===');
  if (!matches.length) { log('  Aucun match'); return; }
  const m = matches[0];
  log('Match: ' + m.home + ' vs ' + m.away + ' (' + m.league + ') id=' + m.id);
  const oj = await post({ mode: 'odds', ids: [m.id] });
  const markets = oj.markets?.[String(m.id)] || [];
  log('Marches: ' + markets.length);
  for (const mk of markets) {
    const sels = (mk.selections || []).map(s => s.name + '=' + s.odd).join(' | ');
    log('  "' + mk.name + '"' + (mk.suspended ? ' [SUSP]' : '') + ' -> ' + sels);
  }
}

for (const sp of ['tennis', 'basketball', 'ice_hockey', 'volleyball']) { await probe(sp); await sleep(1000); }
log('\n=== FIN SONDE ===');
