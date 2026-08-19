// Sonde 1win : combien de groupes de marchés selon les variantes d'abonnement.
import WebSocket from 'ws';
import { API_BASE, ORIGIN, UA, PLATFORM, WIN_SID } from '../src/bookmakers/onewin/api.js';

const now = Math.floor(Date.now() / 1000);
const res = await fetch(`${API_BASE}/matches/get-many`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Referer: ORIGIN + '/', 'User-Agent': UA },
  body: JSON.stringify({ sportId: WIN_SID.football, startAtFrom: now - 3600, startAtTo: now + 86400, limit: 3, offset: 0, l: 'en-001', p: PLATFORM }),
});
const items = (await res.json())?.result?.items || [];
const m = items[0];
console.log('match', m?.id, m?.homeTeam?.name, '-', m?.awayTeam?.name, '| total listes', items.length);

function probe(data, label, { quietMs = 8000, hardMs = 40000 } = {}) {
  return new Promise((resolve) => {
    const url = `wss://api-gateway.top-parser.com/push-server-v2/?Language=en-001&externalPartnerId=${PLATFORM}&EIO=4&transport=websocket`;
    const ws = new WebSocket(url);
    const groups = new Map();
    let phase = 0, started = false, last = Date.now(), wd;
    const hard = setTimeout(fin, hardMs);
    function fin() {
      clearTimeout(hard); if (wd) clearInterval(wd);
      try { ws.close(); } catch { /* ignore */ }
      resolve({ label, groups: groups.size, names: [...groups.keys()].slice(0, 40), totalOdds: [...groups.values()].reduce((a, b) => a + b, 0) });
    }
    ws.on('message', (raw) => {
      const s = raw.toString();
      if (s.startsWith('0') && phase === 0) { ws.send('40'); phase = 1; return; }
      if (s.startsWith('40') && phase <= 1) {
        phase = 2;
        ws.send('42' + JSON.stringify(['subscribe', { messageType: 'subscribe-match-odds', data }]));
        wd = setInterval(() => { if (started && Date.now() - last > quietMs) fin(); }, 500);
        return;
      }
      if (s === '2') { ws.send('3'); return; }
      if (s.startsWith('42')) {
        try {
          const b = JSON.parse(s.slice(2))[1];
          if (/match-odds/.test(b?.messageType || '')) {
            for (const g of b.data?.oddsGroups || []) if (g?.name) groups.set(g.name, g.oddsList?.length || 0);
            started = true; last = Date.now();
          }
          if (b?.messageType && !/match-odds/.test(b.messageType)) console.log('  autre message:', b.messageType);
        } catch { /* ignore */ }
      }
    });
    ws.on('error', fin);
    ws.on('close', fin);
  });
}

const id = m.id;
const variants = [
  [{ matchIds: [id], isBaseOddsGroups: false }, 'isBaseOddsGroups=false (actuel)'],
  [{ matchIds: [id], isBaseOddsGroups: true }, 'isBaseOddsGroups=true'],
  [{ matchIds: [id] }, 'sans le drapeau'],
  [{ matchIds: [id], isBaseOddsGroups: false, isAllOddsGroups: true }, '+isAllOddsGroups'],
  [{ matchIds: [id], isBaseOddsGroups: false, withAllOdds: true, full: true }, '+withAllOdds/full'],
];
for (const [data, label] of variants) {
  const r = await probe(data, label);
  console.log(`[${r.label}] groupes=${r.groups} cotes=${r.totalOdds}`);
  console.log('   ', r.names.join(' | '));
}
process.exit(0);
