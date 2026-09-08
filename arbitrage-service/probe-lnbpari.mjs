// Sonde LNB PARI (Bénin) — flux temps réel BetLab « direct-feed ».
// Exécutée sur le runner GitHub : contrairement au serveur Base44, Node permet
// d'ouvrir le WebSocket AVEC les en-têtes de marque et l'origine que le
// serveur du flux exige (sans eux il ferme la connexion aussitôt).
import WebSocket from 'ws';

const SEP = '\u001e';
const HOSTS = {
  apg: 'wss://apg.lnbpari.com/direct-feed/feed',
  site: 'wss://lnbpari.com/direct-feed/feed',
};

const HEADERS = {
  Origin: 'https://lnbpari.com',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
  'X-Brand': 'BENIN',
  'X-Player-Brand': 'BENIN',
  'X-Operator-Id': '1',
};

const CTX = { language: 'fr', channel: 'web', brand: 'BENIN', playerBrand: 'BENIN', currency: 'XOF' };

function attempt({ host, qs, target, args, wait = 9000 }) {
  const url = `${HOSTS[host]}?${qs}`;
  return new Promise((resolve) => {
    const frames = [];
    let ws;
    try { ws = new WebSocket(url, { headers: HEADERS }); }
    catch (e) { return resolve({ url, error: String(e.message || e) }); }
    const done = () => { try { ws.close(); } catch {} resolve({ url, target, args, frames }); };
    const timer = setTimeout(done, wait);
    let started = false;
    ws.on('open', () => ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + SEP));
    ws.on('message', (raw) => {
      for (const part of raw.toString().split(SEP)) {
        if (part) frames.push(part.length > 900 ? part.slice(0, 900) + '…' : part);
      }
      if (!started) {
        started = true;
        ws.send(JSON.stringify({ type: 4, invocationId: '1', target, arguments: args }) + SEP);
      }
      if (frames.length > 25) { clearTimeout(timer); done(); }
    });
    ws.on('error', (e) => { frames.push('ERREUR ' + String(e.message || e)); clearTimeout(timer); done(); });
    ws.on('close', (c, r) => { frames.push(`FERMETURE ${c} ${r || ''}`); clearTimeout(timer); done(); });
  });
}

const plans = [
  { host: 'site', qs: 'brand=BENIN', target: 'GetSportsByStage', args: [1] },
  { host: 'site', qs: 'brand=BENIN', target: 'GetSportsByStage', args: [1, CTX] },
  { host: 'apg', qs: 'brand=BENIN', target: 'GetSportsByStage', args: [1] },
  { host: 'apg', qs: 'brand=BENIN', target: 'GetSportsByStage', args: [1, CTX] },
  { host: 'apg', qs: 'brand=BENIN', target: 'GetLiveEventsBySport', args: [1, CTX] },
];

for (const p of plans) {
  const r = await attempt(p);
  console.log('\n=== ' + p.host + ' | ' + p.target + ' | args=' + JSON.stringify(p.args) + ' ===');
  console.log(r.url);
  (r.frames || ['(rien)']).forEach((f) => console.log('  ' + f));
  if (r.error) console.log('  erreur socket: ' + r.error);
}
