import { ONEWIN_PLATFORM } from "../../shared/onewinLiveWs.ts";

// Connexion 1win ouverte pendant tout le cycle : les scores et les cotes arrivent
// en direct (poussés par 1win), sans attendre un relevé.
export class OnewinStream {
  odds = new Map<number, Record<string, any[]>>();
  ws: WebSocket | null = null;
  ids = new Set<number>();
  ready = false;
  closed = false;
  constructor(private onScore: (id: number, sc: [number, number], at: number) => void) {}

  start() {
    if (this.closed) return;
    const ws = new WebSocket(`wss://api-gateway.top-parser.com/push-server-v2/?Language=en-001&externalPartnerId=${ONEWIN_PLATFORM}&EIO=4&transport=websocket`);
    this.ws = ws;
    ws.onmessage = (e) => {
      const msg = typeof e.data === "string" ? e.data : "";
      if (msg.startsWith("0")) { ws.send("40"); return; }
      if (msg.startsWith("40")) { this.ready = true; this.sub([...this.ids]); return; }
      if (msg === "2") { ws.send("3"); return; }
      if (!msg.startsWith("42")) return;
      try {
        const body = JSON.parse(msg.slice(2))?.[1];
        const mt = body?.messageType || "", d = body?.data || {};
        if (mt.includes("odds") && d.matchId) {
          const cur = this.odds.get(d.matchId) || {};
          for (const g of d.oddsGroups || []) if (g?.name && g.oddsList?.length) cur[g.name] = g.oddsList.map((o: any) => ({ name: String(o.name ?? ""), cf: Number(o.cf), status: Number(o.status ?? 1) }));
          this.odds.set(d.matchId, cur);
        } else if (mt.includes("info") && d.matchId) {
          const h = Number(d.matchScore?.t1 ?? d.scoreHome), a = Number(d.matchScore?.t2 ?? d.scoreAway);
          if (Number.isFinite(h) && Number.isFinite(a)) this.onScore(d.matchId, [h, a], Date.now());
        }
      } catch { /* message illisible */ }
    };
    ws.onclose = () => { this.ready = false; if (!this.closed) setTimeout(() => this.start(), 500); };
    ws.onerror = () => { try { ws.close(); } catch { /* */ } };
  }

  sub(ids: number[]) {
    if (!this.ready || !this.ws || !ids.length) return;
    this.ws.send("42" + JSON.stringify(["subscribe", { messageType: "subscribe-match-odds", data: { matchIds: ids, isBaseOddsGroups: false } }]));
    this.ws.send("42" + JSON.stringify(["subscribe", { messageType: "subscribe-match-info", data: { matchIds: ids } }]));
  }

  add(ids: number[]) {
    const fresh = ids.filter((i) => !this.ids.has(i));
    fresh.forEach((i) => this.ids.add(i));
    this.sub(fresh);
  }

  stop() { this.closed = true; try { this.ws?.close(); } catch { /* */ } }
}