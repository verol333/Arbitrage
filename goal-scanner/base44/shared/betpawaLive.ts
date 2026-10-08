// ═══════════════════════════════════════════════════════════════════
// BETPAWA — FLUX LIVE COMPLET (tous sports, tous matchs).
//
// Endpoints réels relevés sur cg.betpawa.com (2026-09-14) :
//   GET /api/sportsbook/v4/categories/list
//       → { onlyMeta: [ { category:{id,name}, eventCounts:{live,upcoming} } ] }
//       C'est LA source de vérité des sports : aucun identifiant n'est câblé
//       en dur, donc un sport ajouté par betPawa est pris automatiquement.
//   GET /api/sportsbook/v4/events/lists/by-queries?q=<json url-encodé>
//       q = { queries:[ { query:{ eventType:"LIVE", categories:[id], zones:{} },
//                         skip, take } ] }
//       → { responses:[ { responses:[ event… ] } ] }
//
// ⚠️ PIÈGE MESURÉ : ajouter `view:{ marketTypes:["_1X2"] }` à la requête fait
// DISPARAÎTRE les sports dont le marché principal n'est pas le 1X2 (basket,
// tennis…). On ne filtre donc JAMAIS par marché à la lecture de la liste.
// ═══════════════════════════════════════════════════════════════════

const BASE = "https://cg.betpawa.com/api/sportsbook/v4";

const HEADERS: Record<string, string> = {
  accept: "application/json",
  devicetype: "web",
  origin: "https://cg.betpawa.com",
  referer: "https://cg.betpawa.com/live",
  "x-pawa-brand": "betpawa-congobrazzaville",
  "x-pawa-language": "fr",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  cookie: "bp_country=CG",
};

async function getJson(url: string, timeout = 20000): Promise<any> {
  try {
    const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeout) });
    if (!r.ok) return null;
    return await r.json();
  } catch (_e) {
    return null;
  }
}

export interface BetpawaCategory {
  id: string;
  name: string;
  live: number;
  upcoming: number;
}

/** Tous les sports proposés par betPawa, avec le nombre de matchs live annoncé. */
export async function listBetpawaCategories(): Promise<BetpawaCategory[]> {
  const j = await getJson(`${BASE}/categories/list`);
  return (j?.onlyMeta || []).map((m: any) => ({
    id: String(m?.category?.id ?? ""),
    name: String(m?.category?.name ?? ""),
    live: Number(m?.eventCounts?.live || 0),
    upcoming: Number(m?.eventCounts?.upcoming || 0),
  })).filter((c: BetpawaCategory) => c.id);
}

export interface BetpawaLiveEvent {
  id: string;
  name: string;
  home: string;
  away: string;
  category: string;
  competition: string;
  minute: string | null;
  period: string | null;
  score: string | null;
  starts: string | null;
}

function scoreOf(ev: any): string | null {
  const rows = ev?.results?.participantPeriodResults;
  if (!Array.isArray(rows) || !rows.length) return null;
  // Le total du match porte le libellé/slug « MATCH » ou n'a pas de période.
  const vals: string[] = [];
  for (const side of ["HOME", "AWAY"]) {
    const row = rows.find((r: any) =>
      String(r?.participant?.side || r?.participant?.type || "").toUpperCase().includes(side));
    const per = (row?.periodResults || []).find((p: any) =>
      /match|total|current/i.test(String(p?.period?.slug || p?.period?.name || ""))) || (row?.periodResults || [])[0];
    const v = per?.result ?? per?.value;
    if (v == null) return null;
    vals.push(String(v));
  }
  return vals.length === 2 ? vals.join("-") : null;
}

/** Matchs LIVE d'un sport betPawa (pagination déroulée jusqu'au bout). */
export async function listBetpawaLive(categoryId: string | number, max = 400): Promise<BetpawaLiveEvent[]> {
  const out: BetpawaLiveEvent[] = [];
  const seen = new Set<string>();
  const take = 100;
  for (let skip = 0; skip < max; skip += take) {
    const q = {
      queries: [{ query: { eventType: "LIVE", categories: [String(categoryId)], zones: {} }, skip, take }],
    };
    const j = await getJson(`${BASE}/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`);
    const evs = j?.responses?.[0]?.responses;
    if (!Array.isArray(evs) || !evs.length) break;
    for (const ev of evs) {
      const id = String(ev?.id ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const name = String(ev?.name ?? "");
      const [home, away] = name.split(" - ");
      out.push({
        id,
        name,
        home: (home || "").trim(),
        away: (away || "").trim(),
        category: String(ev?.category?.name ?? ""),
        competition: String(ev?.competition?.name ?? ""),
        minute: ev?.results?.display?.minute ?? null,
        period: ev?.results?.display?.currentPeriod?.name ?? null,
        score: scoreOf(ev),
        starts: ev?.startTime ?? ev?.starts ?? null,
      });
    }
    if (evs.length < take) break;
  }
  return out;
}

/** TOUS les matchs live de TOUS les sports betPawa, regroupés par sport. */
export async function listAllBetpawaLive(): Promise<{
  categories: BetpawaCategory[];
  bySport: Record<string, BetpawaLiveEvent[]>;
  total: number;
}> {
  const categories = await listBetpawaCategories();
  const bySport: Record<string, BetpawaLiveEvent[]> = {};
  let total = 0;
  for (const c of categories) {
    if (c.live <= 0) continue;
    const evs = await listBetpawaLive(c.id);
    if (!evs.length) continue;
    bySport[c.name || c.id] = evs;
    total += evs.length;
  }
  return { categories, bySport, total };
}