// BetMomo via BetConstruct SWARM (WebSocket natif) — même gateway que YellowBet.
// Port fidèle de betmomoClient.ts. Accès direct (pas de Cloudflare).
import WebSocket from 'ws';

const ENDPOINT = 'wss://eu-swarm-newm.betconstruct.com/';
export const BETMOMO_SITE_ID = 122;
// Sport IDs BetMomo (via SWARM sport list) : 1=Football, 2=Ice Hockey,
// 3=Basketball, 4=Tennis, 5=Volleyball.
export const BETMOMO_SID = { football: 1 };

export function swarmSession(cb, { timeoutMs = 45_000 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false; let ws;
    const finish = (fn) => { if (!done) { done = true; try { ws.close(); } catch { /* ignore */ } fn(); } };
    try { ws = new WebSocket(ENDPOINT); } catch (e) { return reject(e); }
    const timer = setTimeout(() => finish(() => reject(new Error('betmomo-swarm-timeout'))), timeoutMs);
    const pending = {}; let ridN = 0;
    const send = (what, where) => new Promise((res) => {
      const rid = 'r' + (++ridN);
      pending[rid] = res;
      ws.send(JSON.stringify({ command: 'get', params: { source: 'betting', what, where }, rid }));
    });
    ws.on('open', () => ws.send(JSON.stringify({ command: 'request_session', params: { site_id: BETMOMO_SITE_ID, language: 'eng' }, rid: 's1' })));
    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.rid === 's1') {
        if (!msg?.data?.sid) { clearTimeout(timer); return finish(() => reject(new Error('betmomo-no-sid'))); }
        try { const out = await cb(send); clearTimeout(timer); finish(() => resolve(out)); }
        catch (e) { clearTimeout(timer); finish(() => reject(e)); }
      } else if (pending[msg.rid]) {
        const r = pending[msg.rid];
        delete pending[msg.rid];
        r(msg?.data?.data);
      }
    });
    ws.on('error', () => { clearTimeout(timer); finish(() => reject(new Error('betmomo-ws-error'))); });
    ws.on('close', (code) => { if (!done) { clearTimeout(timer); finish(() => reject(new Error('betmomo-closed:' + code))); } });
  });
}

export function isOutright(g) {
  if (!g.team1_name || !g.team2_name) return true;
  if (/outright/i.test(String(g.league || ''))) return true;
  return /^\d{4}$|\bchampionship\b|\bwinner\b|\boutright\b|top scorer|to qualify/i.test(String(g.team1_name));
}
export function isVirtual(g) {
  const s = `${g.team1_name || ''} ${g.team2_name || ''} ${g.league || ''}`.toLowerCase();
  return /\bsrl\b|simulated|\besoccer\b|e-?soccer|\bcyber\b|\bvirtual\b|\besports?\b|\bfifa\b|\be-?fighting\b/i.test(s);
}
