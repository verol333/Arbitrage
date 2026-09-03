// Accès Swarm (BetConstruct) pour MaxiBet — site_id 1870852.
// MaxiBet ne publie AUCUNE cote en HTTP : tout passe par ce WebSocket, d'où
// l'invisibilité du flux dans un outil de capture réseau classique.
// Une seule session sert à enchaîner plusieurs requêtes `get`.
import WebSocket from 'ws';

export const HOST = 'wss://eu-swarm-android.betconstruct.com/';
export const SITE_ID = 1870852;
// Lecture en ANGLAIS : les noms d'équipes deviennent internationaux
// (« FC Malines » → « KV Mechelen »), seule forme appariable avec les autres books.
export const LANG = 'eng';
// game.type : 2 = pré-match (vérifié — 1029 matchs foot), 0 = direct + marchés
// statistiques (245 matchs, sans les vraies affiches).
export const TYPE_PREMATCH = 2;

// Exécute une suite de requêtes `get` sur une seule session Swarm.
// steps = [{ rid, params }] → résout avec { [rid]: data }.
export function swarmSession(steps, { timeoutMs = 90_000 } = {}) {
  return new Promise((resolve) => {
    const results = {};
    if (!steps.length) return resolve(results);
    let ws; let settled = false; let idx = 0;
    const finish = () => {
      if (settled) return; settled = true;
      clearTimeout(hard);
      try { ws.close(); } catch { /* déjà fermé */ }
      resolve(results);
    };
    const hard = setTimeout(finish, timeoutMs);
    try { ws = new WebSocket(HOST); } catch { clearTimeout(hard); return resolve(results); }

    const send = () => {
      if (idx >= steps.length) return finish();
      ws.send(JSON.stringify({ command: 'get', params: steps[idx].params, rid: steps[idx].rid }));
    };

    ws.on('open', () => ws.send(JSON.stringify({
      command: 'request_session',
      params: { language: LANG, site_id: String(SITE_ID), source: 42 },
      rid: 'sess',
    })));

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.rid === 'sess') {
        if (msg.code !== 0) return finish();
        return send();
      }
      const s = steps[idx];
      if (s && msg.rid === s.rid) {
        results[s.rid] = msg.data?.data || {};
        idx++;
        send();
      }
    });

    ws.on('error', finish);
    ws.on('close', finish);
  });
}
