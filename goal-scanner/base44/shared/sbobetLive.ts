// SBOBET en direct (football) — OBSERVATION SEULE, aucun compte, aucune mise. Relevé le 17/10/2026 :
//  - Page publique /euro/live-betting/football : liste des matchs en direct + jeton d'affichage ('od') + 'ts'.
//  - /en/data/event?ts=..&tk=<jeton avec pid=15 et eid=match> : tous les marchés d'UN match (~200 ms).
//    Marché [id,[type,0,type,live,limite,ligne,..],[cotes]] : type 3 = total de buts du match (plus, moins).
//    Événement [id,'domicile','extérieur','code',10,'date','',buts dom,buts ext,...].
//  - Le site traite une demande à la fois par session : on ouvre plusieurs sessions pour tout lire en ~1,5 s.
const BASE = "https://www.sbobet.com";
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124" };
const FAKE = /virtu|cyber|esoccer|e-soccer|fifa|simulat|corner|booking|\(et\)|penalt/i;
const N = 3, TTL = 10 * 60000;
let pauseUntil = 0; // blocage Cloudflare 1015 (trop de demandes) : on se tait 2 min
type Sess = { ck: string; v: string[]; ts: string; at: number; page: string };
let pool: Sess[] = [];

const get = async (u: string, ck?: string) => {
  if (Date.now() < pauseUntil) throw new Error("pause");
  const r = await fetch(BASE + u, { headers: ck ? { ...H, Cookie: ck } : H, signal: AbortSignal.timeout(5000) });
  if (r.status === 429) { pauseUntil = Date.now() + 120000; throw new Error("sbobet 429"); }
  return r;
};

async function open(): Promise<Sess | null> {
  const r = await get("/euro/live-betting/football").catch(() => null);
  if (!r?.ok) return null;
  const ck = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const page = await r.text();
  const v = page.match(/'oev','sev','pid','sid','rid','tid','eid','cd','dt','mt','ms','ps'\],\[([^\]]+)\]/)?.[1]?.replace(/'/g, "").split(",");
  const s = page.match(/setToken\('site'[^;]{0,600}/)?.[0]?.match(/\[([^\]]+)\],\[([^\]]+)\]/);
  if (!v || !s) return null;
  const n = s[1].replace(/'/g, "").split(","), vals = s[2].replace(/'/g, "").split(",");
  return { ck, v, ts: vals[n.indexOf("ts")], at: Date.now(), page };
}

const evRe = /\[(\d{7,9}),'((?:[^'\\]|\\.)*)','((?:[^'\\]|\\.)*)','[^']*',\d+,'[^']*','[^']*',(\d+),(\d+)/g;

/** Matchs en direct avec score et totaux de buts : [{ id, home, away, league, score, mk: {TOT_x: [plus, moins]}, locked }]. */
export async function sbList(want: (id: string) => boolean = () => true) {
  if (pool.length < N || Date.now() - pool[0].at > TTL) {
    const fresh: Sess[] = [];
    for (let i = 0; i < N; i++) { const s = await open(); if (s) fresh.push(s); } // sessions ouvertes l'une après l'autre
    if (fresh.length) pool = fresh;
  }
  if (!pool.length) return null;
  // Liste fraîche des matchs en direct (page publique, ~250 ms)
  const first = await get("/euro/live-betting/football").then((r) => r.text()).catch(() => null);
  if (!first) return null;
  const evs = new Map<string, any>();
  for (const x of first.matchAll(evRe)) {
    if (evs.has(x[1]) || FAKE.test(`${x[2]} ${x[3]}`)) continue;
    evs.set(x[1], { id: x[1], home: x[2].replace(/\\'/g, "'"), away: x[3].replace(/\\'/g, "'"), league: "", score: [Number(x[4]), Number(x[5])] as [number, number], mk: {} as Record<string, number[]>, locked: new Set<string>() });
  }
  const list = [...evs.values()];
  // Cotes lues UNIQUEMENT pour les matchs déjà reliés à 1xBet, une demande à la fois par session
  // (lire tous les matchs en parallèle déclenchait le blocage Cloudflare 1015)
  const todo = list.filter((e) => want(e.id));
  await Promise.all(pool.map(async (s, k) => { for (let i = k; i < todo.length; i += pool.length) await readOne(todo[i], s); }));
  return list;
}

async function readOne(e: any, s: Sess) {
  {
    const w = [...s.v];
    w[2] = "15"; w[6] = e.id;
    const b = await get(`/en/data/event?ts=${s.ts}&tk=${w.join(",")}`, s.ck).then((r) => r.text()).catch(() => "");
    const sc = [...b.matchAll(evRe)].find((x) => x[1] === e.id);
    if (sc) e.score = [Number(sc[4]), Number(sc[5])];
    for (const m of b.matchAll(/\[\d{9},\[3,0,3,\d,\d+,(-?[\d.]+),\d+\],\[([\d.]+),([\d.]+)\]\]/g)) {
      const ln = Number(m[1]);
      if (Math.abs(ln % 1 - 0.5) > 1e-6) continue; // lignes .5 seulement (pas de 2.25 / 2.75)
      e.mk[`TOT_${ln}`] = [Number(m[2]), Number(m[3])];
    }
  }
}