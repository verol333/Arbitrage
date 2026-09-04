// Sonde Betclic (via relais Base44) : pour tennis/basket/hockey/volley,
// liste les matchs et dump la structure des marches (nom + selections) du
// 1er match afin d'ecrire les parseurs. Le relais ajoute le mode 'probe'.
const RELAY = 'https://al-ve-pro.base44.app/functions/betclicRelay';
const SECRET = process.env.WEBHOOK_SECRET || '';
const log = (m) => console.log(m);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function probe(sport) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(RELAY, { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json', 'x-webhook-secret': SECRET }, body: JSON.stringify({ mode: 'probe', sport }) });
    const j = await res.json();
    if (!j.ok) { log('  ' + sport + ' -> erreur relais: ' + JSON.stringify(j)); return; }
    log('\n========================================');
    log('=== ' + sport.toUpperCase() + ' (' + j.matchCount + ' matchs, reg=' + j.regulation + ') ===');
    if (!j.matchCount) { log('  Aucun match'); return; }
    log('Match: ' + j.match.home + ' vs ' + j.match.away + ' (' + j.match.competition + ')');
    log('Marches (bouquet defaut): ' + j.markets.length);
    for (const mk of j.markets) {
      const sels = mk.selections.map(s => s.name + '=' + s.odd).join(' | ');
      log('  "' + mk.name + '"' + (mk.suspended ? ' [SUSPENDU]' : '') + ' -> ' + sels);
    }
  } catch (e) { log('  ' + sport + ' -> ' + e.message); } finally { clearTimeout(t); }
}

for (const sp of ['tennis', 'basketball', 'ice_hockey', 'volleyball']) { await probe(sp); await sleep(1000); }
log('\n=== FIN SONDE ===');
