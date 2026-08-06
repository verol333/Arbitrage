// Maxibet (Cameroun/Gabon) via BetConstruct SWARM (WebSocket natif) — meme
// gateway que BetMomo/YellowBet, site_id different. Site_id=211 confirme via
// cross-check cotes 1X2 Benfica vs Heart of Midlothian (screenshot user vs
// probe SWARM : 1.12/12/19 vs 1.13/13/21 — match unique parmi 6 candidats XAF).
// Devise : XAF (franc CFA BEAC), max_payout 1 milliard XAF, supp XOF/XAF/CFA/GNF/USDT.
import WebSocket from 'ws';

const ENDPOINT = 'wss://eu-swarm-newm.betconstruct.com/';
export const MAXIBET_SITE_ID = 211;
export const MAXIBET_SID = { football: 1, tennis: 4 };

export function swarmSession(cb, { timeoutMs = 45_000 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false; let ws;
    const finish = (fn) => { if (!done) { done = true; try { ws.close(); } catch { /* ignore */ } fn(); } };
    try { ws = new WebSocket(ENDPOINT); } catch (e) { return reject(e); }
    const timer = setTimeout(() => finish(() => reject(new Error('maxibet-swarm-timeout'))), timeoutMs);
    const pending = {}; let ridN = 0;
    const send = (what, where) => new Promise((res) => {
      const rid = 'r' + (++ridN);
      pending[rid] = res;
      ws.send(JSON.stringify({ command: 'get', params: { source: 'betting', what, where }, rid }));
    });
    ws.on('open', () => ws.send(JSON.stringify({ command: 'request_session', params: { site_id: MAXIBET_SITE_ID, language: 'eng' }, rid: 's1' })));
    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.rid === 's1') {
        if (!msg?.data?.sid) { clearTimeout(timer); return finish(() => reject(new Error('maxibet-no-sid'))); }
        try { const out = await cb(send); clearTimeout(timer); finish(() => resolve(out)); }
        catch (e) { clearTimeout(timer); finish(() => reject(e)); }
      } else if (pending[msg.rid]) {
        const r = pending[msg.rid];
        delete pending[msg.rid];
        r(msg?.data?.data);
      }
    });
    ws.on('error', () => { clearTimeout(timer); finish(() => reject(new Error('maxibet-ws-error'))); });
    ws.on('close', (code) => { if (!done) { clearTimeout(timer); finish(() => reject(new Error('maxibet-closed:' + code))); } });
  });
}

export async function fetchMatchOdds(matchId) {
  return swarmSession(async (send) => {
    const oddsData = await send(
      { game: ['id'], market: ['name', 'type', 'col_count', 'group_name', 'group_id'], event: ['name', 'price', 'base', 'type_1', 'type'] },
      { game: { id: { '@eq': Number(matchId) } } },
    );
    const g = Object.values(oddsData?.game || {})[0];
    return g ? Object.values(g.market || {}) : [];
  }).catch(() => []);
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
