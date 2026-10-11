// Observation sans mise : penalty accordé et carton rouge.
// À chaque incident vu chez 1xBet, on relève 60 s durant la cote visée chez 1xBet, 1win et betPawa,
// et on mesure combien de temps 1win / betPawa gardent l'ancienne cote après que 1xBet a bougé.
export const INC_MS = 60000;
const MOVE = 0.05; // une cote qui change de plus de 5 % = le site a réagi

type Q = { odd: number | null; locked: boolean } | null;

/** Compare les compteurs 1xBet (rouges, penalties) au relevé précédent ; renvoie les incidents nouveaux. */
export function detect(m: any, g: any, at: number) {
  const out: any[] = [];
  for (const kind of ["rc", "pen"] as const) {
    const now = g[kind];
    if (!now) continue;
    const prev = m[kind];
    m[kind] = now;
    if (!prev) continue;
    for (const side of [0, 1]) if (now[side] > prev[side]) {
      const tot = g.sh + g.sa;
      out.push({ kind, side, t0: at, minute: g.min, sc: `${g.sh}-${g.sa}`,
        // Rouge : vainqueur du match ; penalty : « plus de » la ligne juste au-dessus du score
        key: kind === "rc" ? "1X2" : `TOT_${tot + 0.5}`, pick: kind === "rc" ? (side ? 0 : 2) : 0, rows: [] as string[], q: { x: [], w: [], b: [] } as Record<string, Q[]> });
    }
  }
  if (out.length) (m.inc ||= []).push(...out);
  return out;
}

const pickOf = (mk: any, lk: Set<string> | undefined, key: string, i: number): Q =>
  mk?.[key] ? { odd: mk[key][i] ?? null, locked: !!lk?.has(key) } : null;

export function sampleInc(inc: any, at: number, s: Record<string, { mk: any; lk?: Set<string> } | null>) {
  const sec = Math.round((at - inc.t0) / 1000);
  const parts: string[] = [];
  for (const b of ["x", "w", "b"]) {
    const q = s[b] ? pickOf(s[b]!.mk, s[b]!.lk, inc.key, inc.pick) : null;
    inc.q[b].push(q);
    parts.push(`${b}:${!q ? "—" : q.locked ? "bloqué" : q.odd}`);
  }
  inc.rows.push(`${sec}s ${parts.join(" ")}`);
}

/** Seconde où le site a réagi (cote bloquée ou écart > 5 % de sa première cote). */
function moveAt(qs: Q[]) {
  const first = qs.find((q) => q && !q.locked && q.odd)?.odd;
  if (!first) return null;
  const i = qs.findIndex((q) => q && (q.locked || (q.odd && Math.abs(q.odd / first - 1) > MOVE)));
  return i < 0 ? null : i;
}
/** Secondes pendant lesquelles le site laisse l'ancienne cote ouverte après la réaction de 1xBet. */
function openAfter(qs: Q[], from: number | null) {
  if (from == null) return null;
  const first = qs.find((q) => q && !q.locked && q.odd)?.odd;
  if (!first) return null;
  let n = 0;
  for (let i = from; i < qs.length; i++) { const q = qs[i]; if (q && !q.locked && q.odd && Math.abs(q.odd / first - 1) <= MOVE) n++; else break; }
  return n;
}

export function incRecord(inc: any, m: any, runId: string) {
  const x = moveAt(inc.q.x), w = moveAt(inc.q.w), b = moveAt(inc.q.b);
  const wo = openAfter(inc.q.w, x), bo = openAfter(inc.q.b, x);
  const firstOdd = (qs: Q[]) => qs.find((q) => q && !q.locked && q.odd)?.odd ?? null;
  return {
    run_id: runId, kind: inc.kind === "rc" ? "carton_rouge" : "penalty", match_label: m.name, league: m.league, minute: inc.minute, score: inc.sc,
    side: inc.side ? "exterieur" : "domicile", market_key: inc.key,
    x_move_s: x, w_move_s: w, b_move_s: b, w_open_after_x_s: wo, b_open_after_x_s: bo,
    x_odd_before: firstOdd(inc.q.x), w_odd_before: firstOdd(inc.q.w), b_odd_before: firstOdd(inc.q.b),
    playable: (wo ?? 0) >= 3 || (bo ?? 0) >= 3, timeline: inc.rows.slice(0, 70),
  };
}