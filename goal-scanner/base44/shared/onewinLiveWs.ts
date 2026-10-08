// ═══════════════════════════════════════════════════════════════════════
// 1WIN — lecture des cotes et de l'état des matchs (WebSocket push-server)
// Utilisé par le générateur de coupons LIVE : les cotes live changent en
// permanence, il faut donc les relire à chaque génération (les cotes mises
// en cache sont refusées par le bookmaker : "odd ... is not found").
// ═══════════════════════════════════════════════════════════════════════

export const ONEWIN_PLATFORM = "44ba10e5-7df2-47ab-a44d-dc93803c7a6e";
export const ONEWIN_API = "https://api-gateway.top-parser.com";
const ORIGIN = "https://1win.ng";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

export const ONEWIN_SPORTS: Record<string, { id: number; label: string; totalMin: number; kind: string }> = {
  football:     { id: 18,  label: "Football",     totalMin: 90, kind: "football" },
  tennis:       { id: 33,  label: "Tennis",       totalMin: 0,  kind: "tennis" },
  basket:       { id: 23,  label: "Basketball",   totalMin: 48, kind: "basket" },
  hockey:       { id: 35,  label: "Hockey",       totalMin: 60, kind: "hockey" },
  volleyball:   { id: 27,  label: "Volleyball",   totalMin: 0,  kind: "tennis" },
  baseball:     { id: 29,  label: "Baseball",     totalMin: 0,  kind: "tennis" },
  cricket:      { id: 25,  label: "Cricket",      totalMin: 0,  kind: "tennis" },
};

// Matchs virtuels / e-sport : 1win les range sous le football, avec un pseudo
// de joueur entre parenthèses ("Juventus (wboy)") ou la mention Cyber/Esports.
export function isVirtualPair(home: string, away: string): boolean {
  const txt = `${home} ${away}`.toLowerCase();
  if (/\besports?\b/.test(txt) || /\bcyber\b/.test(txt) || /\(v\)/.test(txt)) return true;
  return /\([a-z0-9._-]{2,}\)/i.test(home) || /\([a-z0-9._-]{2,}\)/i.test(away);
}

export type OneWinMatch = {
  id: number; home: string; away: string; league: string;
  sport: string; kind: string; totalMin: number; startAt: number; virtual: boolean;
};

// ─── Matchs en direct d'un sport (REST) ───
export async function fetchLiveMatches(sportKey: string, offset = 0): Promise<OneWinMatch[]> {
  const sp = ONEWIN_SPORTS[sportKey];
  if (!sp) return [];
  try {
    const res = await fetch(`${ONEWIN_API}/matches/get-many`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Referer: `${ORIGIN}/`, "User-Agent": UA },
      body: JSON.stringify({ sportId: sp.id, isLive: true, limit: 100, offset, l: "en-001", p: ONEWIN_PLATFORM }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.result?.items || [])
      .filter((m: any) => (m.service || "").toUpperCase() === "LIVE" && m.homeTeam?.name && m.awayTeam?.name)
      .map((m: any) => {
        const home = m.homeTeam.name, away = m.awayTeam.name;
        return {
          id: m.id, home, away,
          league: m.tournament?.name || m.league?.name || sp.label,
          sport: sportKey, kind: sp.kind, totalMin: sp.totalMin,
          startAt: m.startAt || 0,
          virtual: sportKey === "football" && isVirtualPair(home, away),
        } as OneWinMatch;
      });
  } catch {
    return [];
  }
}

export type OneWinOdd = { id: string; name: string; cf: number; status: number };
export type OneWinInfo = { scoreHome: number | null; scoreAway: number | null; minute: number | null; status: string | null; raw: any };

// ─── Cotes + état des matchs pour un lot d'identifiants ───
export function fetchOddsAndInfo(
  matchIds: number[],
  timeoutMs = 20000,
  quietMs = 3500,
): Promise<{ odds: Map<number, Record<string, OneWinOdd[]>>; info: Map<number, OneWinInfo> }> {
  const odds = new Map<number, Record<string, OneWinOdd[]>>();
  const info = new Map<number, OneWinInfo>();
  if (!matchIds.length) return Promise.resolve({ odds, info });

  const wsUrl = `wss://api-gateway.top-parser.com/push-server-v2/?Language=en-001&externalPartnerId=${ONEWIN_PLATFORM}&EIO=4&transport=websocket`;

  return new Promise((resolve) => {
    let settled = false, started = false, phase = 0;
    let lastUpdate = Date.now();
    let watchdog: number | undefined;
    let ws: WebSocket;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (watchdog) clearInterval(watchdog);
      clearTimeout(hard);
      try { ws.close(); } catch { /* déjà fermé */ }
      resolve({ odds, info });
    };
    const hard = setTimeout(finish, timeoutMs);

    try { ws = new WebSocket(wsUrl); } catch { clearTimeout(hard); resolve({ odds, info }); return; }

    ws.onmessage = (event: MessageEvent) => {
      const msg = typeof event.data === "string" ? event.data : "";
      if (msg.startsWith("0") && phase === 0) { ws.send("40"); phase = 1; return; }
      if (msg.startsWith("40") && phase <= 1) {
        phase = 2;
        ws.send("42" + JSON.stringify(["subscribe", { messageType: "subscribe-match-odds", data: { matchIds, isBaseOddsGroups: false } }]));
        ws.send("42" + JSON.stringify(["subscribe", { messageType: "subscribe-match-info", data: { matchIds } }]));
        watchdog = setInterval(() => { if (started && Date.now() - lastUpdate > quietMs) finish(); }, 400) as unknown as number;
        return;
      }
      if (msg === "2") { ws.send("3"); return; }
      if (!msg.startsWith("42")) return;
      try {
        const payload = JSON.parse(msg.slice(2));
        const body = Array.isArray(payload) ? payload[1] : null;
        const mt = body?.messageType || "";
        if (mt.includes("odds")) {
          const id = body.data?.matchId;
          if (!id) return;
          const existing = odds.get(id) || {};
          for (const g of (body.data?.oddsGroups || [])) {
            if (!g?.name || !g.oddsList?.length) continue;
            existing[g.name] = g.oddsList.map((o: any) => ({
              id: String(o.id), name: String(o.name ?? o.outcome ?? ""), cf: Number(o.cf), status: Number(o.status ?? 1),
            }));
          }
          odds.set(id, existing);
          started = true; lastUpdate = Date.now();
        } else if (mt.includes("info")) {
          const d = body.data || {};
          if (!d.matchId) return;
          const prev = info.get(d.matchId);
          const next: OneWinInfo = {
            scoreHome: numOrNull(d.matchScore?.t1 ?? d.scoreHome ?? d.score?.home),
            scoreAway: numOrNull(d.matchScore?.t2 ?? d.scoreAway ?? d.score?.away),
            minute: readMinute(d),
            status: typeof d.status === "string" ? d.status : prev?.status ?? null,
            raw: d,
          };
          // Les mises à jour partielles n'embarquent pas toujours le score :
          // on conserve la dernière valeur connue plutôt que de la perdre.
          info.set(d.matchId, {
            scoreHome: next.scoreHome ?? prev?.scoreHome ?? null,
            scoreAway: next.scoreAway ?? prev?.scoreAway ?? null,
            minute: next.minute ?? prev?.minute ?? null,
            status: next.status,
            raw: next.raw,
          });
          started = true; lastUpdate = Date.now();
        }
      } catch { /* message non exploitable */ }
    };
    ws.onerror = finish;
    ws.onclose = finish;
  });
}

function numOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Le chronomètre arrive sous plusieurs formes selon le sport : secondes,
// objet { seconds }, ou texte "63:12". On lit tout ce qui est exploitable.
function readMinute(d: any): number | null {
  // 1win envoie `matchTime` en millisecondes écoulées (2700000 = 45ᵉ minute).
  const ms = Number(d.matchTime);
  if (Number.isFinite(ms) && ms > 0) return Math.floor(ms / 60000);
  const t = d.timer ?? d.time ?? null;
  if (t == null) return null;
  if (typeof t === "number") return Math.floor(t >= 1000 ? t / 60000 : t >= 200 ? t / 60 : t);
  if (typeof t === "string") {
    const m = t.match(/(\d+)\s*:\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    const n = Number(t);
    return Number.isFinite(n) ? Math.floor(n >= 200 ? n / 60 : n) : null;
  }
  if (typeof t === "object") {
    const sec = Number(t.seconds ?? t.sec ?? t.elapsed ?? t.value);
    if (Number.isFinite(sec)) return Math.floor(sec >= 200 ? sec / 60 : sec);
    const mi = Number(t.minutes ?? t.minute);
    if (Number.isFinite(mi)) return Math.floor(mi);
  }
  return null;
}