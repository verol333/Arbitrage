import { fetchLiveMatches, fetchOddsAndInfo, ONEWIN_PLATFORM } from "../../shared/onewinLiveWs.ts";
import { findOdd } from "./autoBet.ts";

// Relevé brut des messages de cotes 1win d'un match (8 s) : quels groupes, combien de lignes par message.
async function rawProbe(id: number) {
  if (!id) return null;
  const out: string[] = [];
  const ws = new WebSocket(`wss://api-gateway.top-parser.com/push-server-v2/?Language=en-001&externalPartnerId=${ONEWIN_PLATFORM}&EIO=4&transport=websocket`);
  ws.onmessage = (e) => {
    const m = String(e.data);
    if (m.startsWith("0")) return ws.send("40");
    if (m.startsWith("40")) return ws.send("42" + JSON.stringify(["subscribe", { messageType: "subscribe-match-odds", data: { matchIds: [id], isBaseOddsGroups: false } }]));
    if (m === "2") return ws.send("3");
    try {
      const b = JSON.parse(m.slice(2))?.[1];
      for (const g of b?.data?.oddsGroups || []) if (/total/i.test(g.name) && !/corner|card/i.test(g.name) && out.length < 40)
        out.push(`${g.name} [${g.id ?? "?"}]: ${(g.oddsList || []).map((o: any) => `${o.name}/${o.vars?.v1 ?? ""}@${o.cf}`).join(" ; ")}`);
    } catch { /* */ }
  };
  await new Promise((r) => setTimeout(r, 8000));
  try { ws.close(); } catch { /* */ }
  return out;
}

// Auto-test sans miser : 1) derby au nom proche, 2) vraies cotes 1win en direct + chemin complet de mise à blanc.
export async function selfTest(db: any) {
  const derby: any = { "CSKA Sofia 1948 Total": [{ id: 1, name: "Over 2.5", cf: 1.5 }], "CSKA Sofia Total": [{ id: 2, name: "Over 2.5", cf: 1.4 }] };
  const derbyOk = findOdd(derby, "CSKA Sofia 1948", "ITH_2.5", 0)?.id === 1 && findOdd(derby, "CSKA Sofia 1948", "ITA_2.5", 0)?.id === 2;
  const { execBet } = await import("../../shared/probAutoExec.ts");
  const live = (await fetchLiveMatches("football", 0)).filter((m: any) => !m.virtual).slice(0, 15);
  const od = await fetchOddsAndInfo(live.map((m: any) => m.id), 5000, 600);
  const tried: any[] = [];
  for (const m of live) {
    const g = od.odds.get(m.id) as any;
    for (const key of ["ITH_0.5", "ITA_0.5", "TOT_2.5", "TOT_3.5"]) {
      const f = findOdd(g, m.home, key, 0);
      if (!f) continue;
      const r = await execBet(db, { dry: true, o: { id: f.id, cf: f.cf, status: f.status }, base: { signal_key: `selftest|${m.id}|${key}|${Date.now()}`, source: "goal", match_label: `${m.home} - ${m.away}`, minute: 0, score: "", market_key: key, market_label: key, odd: f.cf, onewin_match_id: m.id } });
      tried.push({ match: `${m.home} - ${m.away}`, key, cote: f.cf, etat: f.status, resultat: r });
      break;
    }
    if (tried.length >= 3) break;
  }
  const g0 = od.odds.get(live[0]?.id) as any;
  const groupes = g0 ? Object.entries(g0).filter(([k]) => /total/i.test(k)).map(([k, l]: any) => `${k}: ${l.slice(0, 3).map((o: any) => o.name).join(" | ")}`) : [];
  const brut = await rawProbe(live[0]?.id);
  return { brut, derbyOk, equipe: live[0] && `${live[0].home} - ${live[0].away}`, groupes, matchsEnDirect: live.length, avecCotes: live.filter((m: any) => od.odds.get(m.id)).length, essais: tried };
}