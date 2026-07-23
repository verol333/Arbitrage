// Lecture cotes 1win via WebSocket (Engine.IO / socket.io). Port fidèle de matchCore.ts.
// Retourne Map<matchId, { groupName: [odds…] }>. Le parseur applique winFlatOdds ensuite.
import WebSocket from 'ws';
import { PLATFORM } from './api.js';

export function fetchOddsWS(matchIds, { timeoutMs = 35_000, quietMs = 5_000 } = {}) {
  const oddsMap = new Map();
  if (!matchIds.length) return Promise.resolve(oddsMap);
  const url = `wss://api-gateway.top-parser.com/push-server-v2/?Language=en-001&externalPartnerId=${PLATFORM}&EIO=4&transport=websocket`;
  return new Promise((resolve) => {
    let settled = false; let ws; let started = false; let lastUpdate = Date.now(); let watchdog;
    function finish() {
      if (settled) return; settled = true;
      if (watchdog) clearInterval(watchdog);
      clearTimeout(hard);
      try { ws.close(); } catch { /* ignore */ }
      resolve(oddsMap);
    }
    const hard = setTimeout(finish, timeoutMs);
    try { ws = new WebSocket(url); } catch { clearTimeout(hard); resolve(oddsMap); return; }
    let phase = 0;
    ws.on('message', (raw) => {
      const msg = raw.toString();
      if (msg.startsWith('0') && phase === 0) { ws.send('40'); phase = 1; return; }
      if (msg.startsWith('40') && phase <= 1) {
        phase = 2;
        ws.send('42' + JSON.stringify(['subscribe', { messageType: 'subscribe-match-odds', data: { matchIds, isBaseOddsGroups: false } }]));
        watchdog = setInterval(() => { if (started && Date.now() - lastUpdate > quietMs) finish(); }, 500);
        return;
      }
      if (msg === '2') { ws.send('3'); return; }
      if (msg.startsWith('42')) {
        try {
          const payload = JSON.parse(msg.slice(2));
          if (!Array.isArray(payload) || payload.length < 2) return;
          const b = payload[1];
          const mt = b?.messageType || '';
          if (mt === 'match-odds-snapshot' || mt === 'match-odds-update') {
            const mid = b.data?.matchId;
            if (!mid) return;
            const groups = b.data?.oddsGroups || [];
            const ex = oddsMap.get(mid) || {};
            for (const g of groups) if (g.name && g.oddsList?.length) ex[g.name] = g.oddsList;
            oddsMap.set(mid, ex);
            started = true; lastUpdate = Date.now();
          }
        } catch { /* ignore */ }
      }
    });
    ws.on('error', finish);
    ws.on('close', finish);
  });
}
