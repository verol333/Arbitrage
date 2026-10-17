import { fair, label } from "./liveMarkets.ts";
import { verdict } from "./probLag.ts";

// Chutes de cote « chacun chez soi » : chaque site surveille TOUS ses propres matchs en direct, sans relier
// les matchs entre sites. Football, nombre de buts du match « plus de X,5 » uniquement. Observation seule.
// Règles : chute ≥ 10 % en 50-120 s, cote de départ ≤ 4.5, arrivée 1.30-2.60, aucun but dans les 3 dernières
// minutes, aucun but dans les 45 s qui suivent, marchés de buts non suspendus, 10e-75e minute (si connue).
const KEY = /^TOT_\d+\.5$/;
const IDK: Record<string, string> = { x: "1xbet", w: "1win", b: "betpawa", c: "congobet", y: "yellowbet", p: "pinnacle", s: "sbobet" };
const NAME: Record<string, string> = { x: "1xBet", w: "1win", b: "betPawa", c: "Congobet", y: "Yellowbet", p: "Pinnacle", s: "SBOBET" };
const pct = (v: number) => Math.round(v * 1000) / 10;
export type Snap = { at: number; min?: number | null; sc: [number, number]; mk: Record<string, number[]>; lk?: Set<string> };
type Ev = { id: string | number; home: string; away: string; league?: string };

export function createSolo(signals: any[], pending: any[], settle: Record<string, any>) {
  const T = new Map<string, any>();
  const live: Record<string, Set<string>> = {};
  const odd = (s: Snap, k: string) => (s.mk[k] && !s.lk?.has(k) ? s.mk[k][0] : null);

  function feed(bk: string, e: Ev, s: Snap) {
    const key = `${bk}|${e.id}`;
    (live[bk] ||= new Set()).add(String(e.id));
    let t = T.get(key);
    if (!t) { t = { hist: [], pend: [], last: {}, m: { name: `${e.home} - ${e.away}`, league: e.league || "", [bk]: e.id } }; T.set(key, t); }
    const g = s.sc[0] + s.sc[1];
    // Résultat des signaux en attente (cycles précédents) pour ce match chez ce site
    for (const sig of pending) if (String(sig.book_ids?.[IDK[bk]]) === String(e.id) && !settle[sig.id]?.status) {
      const v = verdict(sig, s.sc, false);
      settle[sig.id] = { last_score: s.sc.join("-"), ...(s.min != null ? { last_minute: s.min } : {}), ...(v ? { status: v, settled_at: new Date().toISOString() } : {}) };
    }
    t.hist.push(s);
    t.hist = t.hist.filter((o: Snap) => s.at - o.at <= 180000);
    t.pend = t.pend.filter((p: any) => {
      if (g !== p.g) return false; // but juste après : faux signal
      if (s.at - p.t0 < 45000) return true;
      signals.push(p);
      return false;
    });
    if (s.min != null && (s.min < 10 || s.min > 75)) return;
    // Marchés de buts suspendus en bloc (incident en cours) ; une ligne isolée fermée ne bloque pas les autres
    const tk = Object.keys(s.mk).filter((k) => KEY.test(k));
    if (tk.length && tk.filter((k) => s.lk?.has(k)).length * 2 >= tk.length) return;
    const h = t.hist, base = h.find((o: Snap) => s.at - o.at >= 50000 && s.at - o.at <= 120000);
    if (!base) return;
    if (h.some((o: Snap) => o.sc[0] + o.sc[1] !== g)) return; // but dans les 3 dernières minutes
    const sec = Math.round((s.at - base.at) / 1000);
    for (const k of Object.keys(s.mk)) {
      if (!KEY.test(k)) continue;
      const ln = parseFloat(k.split("_")[1]);
      if (ln < g) continue;
      const o0 = odd(base, k), o1 = odd(s, k);
      if (!o0 || !o1) continue;
      const drop = 1 - o1 / o0;
      if (drop < 0.15 || o0 > 4.5 || o1 < 1.3 || o1 > 2.6) continue;
      // Échelle décalée d'un cran = but déjà intégré par le site, pas une vraie chute
      const lo = odd(base, `TOT_${ln - 1}`), hi = odd(s, `TOT_${ln + 1}`);
      if ((lo && Math.abs(o1 / lo - 1) < 0.1) || (hi && Math.abs(hi / o0 - 1) < 0.1)) continue;
      if (t.last[k] && s.at - t.last[k] < 300000) continue;
      t.last[k] = s.at;
      const p = fair(s.mk[k]);
      t.pend.push({
        g, m: t.m, key: k, book: "Chute", side: 0, line: ln, t0: s.at, odd: o1, q: p[0], pref: p[0],
        p0: fair(base.mk[k])[0], edge: drop, min: s.min ?? null, sc: s.sc.join("-"), open_s: sec, followed_s: null, goal: false,
        trace: [`${NAME[bk]} ${label(k, 0)} : ${o0} → ${o1} (−${pct(drop)} %) en ${sec} s`],
      });
    }
  }

  /** Le match du signal est encore en direct chez l'un de ses sites. */
  const isLive = (sig: any) => Object.entries(IDK).some(([bk, n]) => sig.book_ids?.[n] != null && live[bk]?.has(String(sig.book_ids[n])));
  const count = () => Object.fromEntries(Object.entries(live).map(([bk, s]) => [NAME[bk], { matchs: s.size, avecTotaux: [...T.entries()].filter(([k, t]) => k.startsWith(bk + "|") && Object.keys(t.hist.at(-1)?.mk || {}).some((x) => KEY.test(x))).length }]));
  return { feed, isLive, count };
}