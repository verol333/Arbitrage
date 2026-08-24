// Sonde 1win : groupes de marches par match (plusieurs matchs, 2 variantes).
import WebSocket from 'ws';
import { API_BASE, ORIGIN, UA, PLATFORM, WIN_SID } from '../src/bookmakers/onewin/api.js';

const now = Math.floor(Date.now() / 1000);
const res = await fetch(`${API_BASE}/matches/get-many`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Referer: ORIGIN + '/', 'User-Agent': UA },
  body: JSON.stringify({ sportId: WIN_SID.football, startAtFrom: now - 3600, startAtTo: now + 3 * 86400, limit: 1000, offset: 0, l: 'en-001', p: PLATFORM }),
});
const items = (await res.json())?.result?.items || [];
console.log('matchs listes:', items.length);
const ids = items.slice(0, 8).map((m) => m.id);
console.log('echantillon:', items.slice(0, 8).map((m) => `${m.id} ${m.homeTeam?.name}-${m.awayTeam?.name}`).join(' ; '));

function probe(data, { quietMs = 10000, hardMs = 60000 } = {}) {
  return new Promise((resolve) => {
    const url = `wss://api-gateway.top-parser.com/push-server-v2/?Language=en-001&externalPartnerId=${PLATFORM}&EIO=4&transport=websocket`;
    const ws = new WebSocket(url);
    const per = new Map();
    let phase = 0, started = false, last = Date.now(), wd;
    const hard = setTimeout(fin, hardMs);
    function fin() {
      clearTimeout(hard); if (wd) clearInterval(wd);
      try { ws.close(); } catch { /* ignore */ }
      resolve(per);
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
            const mid = b.data?.matchId;
            const g = per.get(mid) || new Map();
            for (const x of b.data?.oddsGroups || []) if (x?.name) g.set(x.name, x.oddsList?.length || 0);
            per.set(mid, g);
            started = true; last = Date.now();
          }
        } catch { /* ignore */ }
      }
    });
    ws.on('error', fin);
    ws.on('close', fin);
  });
}

for (const flag of [false, true]) {
  const per = await probe({ matchIds: ids, isBaseOddsGroups: flag });
  console.log(`\n--- isBaseOddsGroups=${flag} : ${per.size} matchs repondus ---`);
  let best = null;
  for (const [mid, g] of per) {
    console.log(`  match ${mid} : groupes=${g.size} cotes=${[...g.values()].reduce((a, b) => a + b, 0)}`);
    if (!best || g.size > best[1].size) best = [mid, g];
  }
  if (best) console.log('  groupes du meilleur match:', [...best[1].keys()].join(' | '));
}
process.exit(0);
