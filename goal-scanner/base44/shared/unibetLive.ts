// Unibet (moteur Kambi) en direct — OBSERVATION SEULE. Relevé le 17/10/2026 :
//  - listView/football/.../in-play.json : tous les matchs en direct + minute + score (une lecture).
//  - betoffer/event/<id>.json : tous les marchés d'UN match. « Total Goals » (occurrenceType GOALS,
//    FULL_TIME), cotes et lignes ×1000, outcome.status OPEN = jouable.
const BASE = "https://eu-offering-api.kambicdn.com/offering/v2018/ub";
const Q = "lang=fr_FR&market=FR";
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124" };
const FAKE = /virtu|cyber|esoccer|e-soccer|fifa|simulat|srl/i;

const get = async (u: string) => {
  const r = await fetch(`${BASE}${u}${u.includes("?") ? "&" : "?"}${Q}`, { headers: H, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`unibet ${r.status}`);
  return r.json();
};

export async function ubList() {
  const j = await get("/listView/football/all/all/all/in-play.json");
  return (j.events || []).filter((x: any) => x.event?.state === "STARTED" && x.liveData?.score && !FAKE.test(`${x.event.name} ${x.event.group}`))
    .map((x: any) => ({
      id: String(x.event.id), home: x.event.homeName, away: x.event.awayName, league: x.event.group,
      min: x.liveData.matchClock?.minute ?? null,
      score: [Number(x.liveData.score.home), Number(x.liveData.score.away)] as [number, number],
    }));
}

export async function ubSnap(id: string) {
  const j = await get(`/betoffer/event/${id}.json`);
  const mk: Record<string, number[]> = {}, locked = new Set<string>();
  for (const b of j.betOffers || []) {
    if (b.criterion?.englishLabel !== "Total Goals" || b.criterion?.lifetime !== "FULL_TIME") continue;
    const o = b.outcomes?.find((x: any) => x.type === "OT_OVER"), u = b.outcomes?.find((x: any) => x.type === "OT_UNDER");
    if (!o?.odds || !u?.odds) continue;
    const ln = o.line / 1000;
    if ((ln * 2) % 2 !== 1) continue;
    const k = `TOT_${ln}`;
    mk[k] = [o.odds / 1000, u.odds / 1000];
    if (b.suspended || o.status !== "OPEN" || u.status !== "OPEN") locked.add(k);
  }
  return { mk, locked };
}