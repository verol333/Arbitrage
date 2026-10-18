// Pinnacle en direct (football) — OBSERVATION SEULE, aucun compte, aucune mise.
// Flux public « guest » (clé publique du site). Relevé le 16/10/2026 :
//  - /sports/29/matchups/live : un match = un « parent » + plusieurs lignes enfants.
//    On ne garde que units = "Regular" (les lignes « (Corners) » ont un score = nombre de corners !).
//    Score : participants[].state.score ; corners : parent.participants[].state.corners.
//    liveMode (danger_zone / live_delay) : réglage de la ligne, noté tel quel.
//  - /sports/29/markets/live/straight : tous les marchés en une demande.
//    total p0 → TOT_x, team_total p0 home/away → ITH_x / ITA_x, total p1 → H1TOT_x, team_total p1 → H1ITH_x / H1ITA_x.
//    Cotes au format américain → converties en décimal. status ≠ "open" = suspendu.
const B = "https://guest.api.arcadia.pinnacle.com/0.1";
const H = { "X-API-Key": "CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R", "User-Agent": "Mozilla/5.0", accept: "application/json" };
const FAKE = /virtu|cyber|esoccer|e-soccer|fifa|simulat|\(corners\)|\(bookings\)/i;

const get = (p: string, ms = 4000) => fetch(B + p, { headers: H, signal: AbortSignal.timeout(ms) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const dec = (p: number) => Math.round((p > 0 ? 1 + p / 100 : 1 + 100 / Math.abs(p)) * 1000) / 1000;

/** Matchs en direct : id = match parent, kids = lignes qui portent les marchés. */
export async function pnList() {
  const a = await get("/sports/29/matchups/live");
  if (!Array.isArray(a)) return null;
  const by = new Map<string, any>();
  for (const m of a) {
    const p = m.participants;
    if (m.units !== "Regular" || p?.[0]?.alignment !== "home" || p?.[1]?.alignment !== "away") continue;
    if (FAKE.test(`${m.league?.name} ${p[0].name} ${p[1].name}`)) continue;
    const hs = Number(p[0].state?.score), as = Number(p[1].state?.score);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    const id = String(m.parentId || m.id);
    const pp = m.parent?.participants;
    const e = by.get(id) || { id, home: p[0].name, away: p[1].name, league: m.league?.name, score: [hs, as] as [number, number], kids: [] as number[], modes: [] as string[] };
    e.kids.push(m.id);
    if (m.liveMode && !e.modes.includes(m.liveMode)) e.modes.push(m.liveMode);
    // state 1 = 1re mi-temps, 2 = 2e mi-temps (minutes repartent de 0)
    const st = m.state?.state, mn = Number(m.state?.minutes);
    e.min = Number.isFinite(mn) && (st === 1 || st === 2) ? mn + (st === 2 ? 45 : 0) : null;
    if (pp?.[0]?.state?.corners != null) e.corners = [Number(pp[0].state.corners), Number(pp[1].state.corners)];
    by.set(id, e);
  }
  return [...by.values()];
}

/** Tous les marchés « buts » en direct, par ligne enfant : { mk: {clé: [plus, moins]}, locked }. */
export async function pnMarkets() {
  // 17/10/2026 : ~8 000 marchés (plusieurs Mo) — 4 s ne suffisaient pas depuis GitHub, et l'échec
  // renvoyait une liste VIDE que le scanner enregistrait comme « aucun total » (3 matchs sur 198).
  const a = await get("/sports/29/markets/live/straight", 15000);
  const out = new Map<number, { mk: Record<string, number[]>; locked: Set<string> }>();
  if (!Array.isArray(a)) return null;
  for (const x of a) {
    if ((x.type !== "total" && x.type !== "team_total") || (x.period !== 0 && x.period !== 1)) continue;
    const o = x.prices?.find((q: any) => q.designation === "over"), u = x.prices?.find((q: any) => q.designation === "under");
    if (!o || !u || (o.points * 2) % 2 !== 1) continue;
    const base = x.type === "total" ? "TOT" : x.side === "home" ? "ITH" : x.side === "away" ? "ITA" : "";
    if (!base) continue;
    const k = `${x.period === 1 ? "H1" : ""}${base}_${o.points}`;
    const e = out.get(x.matchupId) || { mk: {}, locked: new Set<string>() };
    e.mk[k] = [dec(o.price), dec(u.price)];
    if (x.status !== "open") e.locked.add(k);
    out.set(x.matchupId, e);
  }
  return out;
}

/** Marchés d'un match = réunion de ses lignes enfants. */
export function pnSnap(all: Map<number, any>, kids: number[]) {
  const mk: Record<string, number[]> = {}, locked = new Set<string>();
  for (const id of kids) { const e = all.get(id); if (!e) continue; Object.assign(mk, e.mk); for (const k of e.locked) locked.add(k); }
  return { mk, locked };
}