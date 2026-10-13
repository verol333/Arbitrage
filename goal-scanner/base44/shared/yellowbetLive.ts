import { sameTeam } from "./teamMatch.ts";

// Yellowbet en direct (football) — OBSERVATION SEULE, aucune mise.
// Lecture directe du site ; si l'adresse est bloquée (403 / Cloudflare), passage par le relais.
//
// CORRESPONDANCE DES MARCHÉS (relevée le 13/10/2026 sur des matchs en direct) :
//   « Under/Over »                → total du match           TOT_x     (issues o/u, ligne dans `l`)
//   « <Équipe dom.> total »       → total équipe domicile     ITH_x     (nom EXACT de l'équipe, sinon ignoré)
//   « <Équipe ext.> total »       → total équipe extérieur    ITA_x
//   « Halftime : Total »          → total 1re mi-temps        H1TOT_x   (ids 1/2, le sens est dans `n` Under/Over)
//   « 1st half - <Équipe> total » → total 1re MT de l'équipe  H1ITH_x / H1ITA_x
// Pièges écartés : « 2nd half - … total », « … exact goals », « Double chance & total » (noms différents) ;
// statut `s` ≠ 0 (marché ou issue) = suspendu ; cote 1,01 = issue déjà réglée, donc bloquée.
const EV = "https://yellowbet.cg/services/evapi/event/GetEvents";
const FAKE = /\bsrl\b|virtu|cyber|esoccer|e-soccer|fifa|simulat/i;
type Mk = Record<string, number[]>;

async function get(path: string): Promise<any> {
  const direct = await fetch(`https://yellowbet.cg${path}`, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 Chrome/124" }, signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (direct?.ok) { const j = await direct.json().catch(() => null); if (j) return j; }
  const url = Deno.env.get("YB_RELAY_URL");
  if (!url) return null;
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-relay-secret": Deno.env.get("YB_RELAY_SECRET") || "" }, body: JSON.stringify({ requests: [{ path, method: "GET" }] }), signal: AbortSignal.timeout(8000) }).then((x) => x.json()).catch(() => null);
  try { return JSON.parse(r?.results?.[0]?.text); } catch (_e) { return null; }
}

/** Tous les matchs de football en direct avec leur score. */
export async function ybList() {
  const pages = await Promise.all([0, 300, 600, 900, 1200].map((s) => get(`/services/evapi/event/GetEvents?take=300&eventTypeId=0&skip=${s}&betTypeIds=-1`)));
  const out: any[] = [], seen = new Set<string>();
  for (const e of pages.flatMap((p) => p?.data || [])) {
    if (e.sid !== 31 || !e.lv || seen.has(String(e.id)) || FAKE.test(`${e.ln} ${e.h} ${e.a}`)) continue;
    seen.add(String(e.id));
    const hs = Number(e.lv.hs), as = Number(e.lv.as);
    out.push({ id: String(e.id), home: e.h, away: e.a, score: Number.isFinite(hs) && Number.isFinite(as) ? [hs, as] as [number, number] : null });
  }
  return out;
}

/** Un match : score + totaux match / équipes / 1re mi-temps. mk[k] = [plus, moins]. */
export async function ybSnap(id: string) {
  const j = await get(`/services/evapi/event/GetEvents?take=5&eventTypeId=0&skip=0&eventIds=${id}`);
  const ev = (j?.data || []).find((e: any) => String(e.id) === id);
  if (!ev?.lv) return null;
  const mk: Mk = {}, locked = new Set<string>();
  const h = String(ev.h || "").trim(), a = String(ev.a || "").trim();
  const ou = (bt: any, key: string) => {
    const by: Record<string, { o?: any; u?: any }> = {};
    for (const o of bt.odds || []) {
      const side = String(o.n || "").toLowerCase();
      if (side !== "over" && side !== "under") continue;
      const l = parseFloat(o.l);
      if (!Number.isFinite(l) || l % 1 !== 0.5) continue;
      (by[l] ||= {})[side === "over" ? "o" : "u"] = o;
    }
    for (const [l, { o, u }] of Object.entries(by)) {
      if (!o || !u) continue;
      const k = `${key}_${l}`;
      mk[k] = [Number(o.p), Number(u.p)];
      if (bt.s !== 0 || o.s !== 0 || !(Number(o.p) > 1.01)) locked.add(k);
    }
  };
  for (const bt of ev.bts || []) {
    const n = String(bt.n || "").trim();
    if (n === "Under/Over") ou(bt, "TOT");
    else if (n === "Halftime : Total") ou(bt, "H1TOT");
    else if (h !== a && n === `${h} total`) ou(bt, "ITH");
    else if (h !== a && n === `${a} total`) ou(bt, "ITA");
    else if (h !== a && n === `1st half - ${h} total`) ou(bt, "H1ITH");
    else if (h !== a && n === `1st half - ${a} total`) ou(bt, "H1ITA");
  }
  return { score: [Number(ev.lv.hs), Number(ev.lv.as)] as [number, number], mk, locked };
}

export const ybSame = (e: any, home: string, away: string) => sameTeam(e.home, home) && sameTeam(e.away, away);