import { fair, label } from "./liveMarkets.ts";
import { verdict } from "./probLag.ts";
import { sameTeam } from "./teamMatch.ts";
// Même match même si un site écrit autrement une des deux équipes (« Jaguares FC » / « Jaguares de Chiapas »)
export function sameMatch(l1: unknown, l2: unknown): boolean {
  const [a, b] = String(l1 || "").split(" - "), [h, w] = String(l2 || "").split(" - ");
  if (!a || !b || !h || !w) return false;
  return sameTeam(a, h) || sameTeam(b, w) || sameTeam(a, w) || sameTeam(b, h);
}

// Chutes de cote « chacun chez soi » : chaque site surveille TOUS ses propres matchs en direct, sans relier
// les matchs entre sites. Football, nombre de buts du match « plus de X,5 » uniquement. Observation seule.
// Règles : chute ≥ 10 % en 50-120 s, cote de départ ≤ 4.5, arrivée 1.30-2.60, aucun but dans les 3 dernières
// minutes, aucun but dans les 45 s qui suivent, marchés de buts non suspendus, 10e-75e minute (si connue).
const KEY = /^TOT_\d+\.5$/;
const IDK: Record<string, string> = { x: "1xbet", w: "1win", b: "betpawa", c: "congobet", y: "yellowbet", p: "pinnacle", s: "sbobet", u: "unibet", o: "sportybet" };
const NAME: Record<string, string> = { x: "1xBet", w: "1win", b: "betPawa", c: "Congobet", y: "Yellowbet", p: "Pinnacle", s: "SBOBET", u: "Unibet", o: "SportyBet" };
const pct = (v: number) => Math.round(v * 1000) / 10;
export type Snap = { at: number; min?: number | null; sc: [number, number]; mk: Record<string, number[]>; lk?: Set<string> };
// Relevé brut d'un site : heure, minute, score et toutes les cotes de buts (🔒 = fermée)
const dump = (s: Snap) => `${new Date(s.at).toISOString().slice(11, 19)} ${s.min ?? "?"}' ${s.sc.join("-")} | ` +
  Object.keys(s.mk).filter((k) => KEY.test(k)).sort().map((k) => `${k.slice(4)}:${s.mk[k].join("/")}${s.lk?.has(k) ? "🔒" : ""}`).join(" ");
type Ev = { id: string | number; home: string; away: string; league?: string };

export function createSolo(signals: any[], pending: any[], settle: Record<string, any>) {
  const T = new Map<string, any>();
  // Nombre de matchs qui « chutent » dans le même relevé d'un site : 3+ en même temps = défaut de lecture
  const burst = new Map<string, Set<string>>();
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
      settle[sig.id] = { last_score: s.sc.join("-"), ...(s.min != null ? { last_minute: s.min } : {}), ...(v && sig.status === "pending" ? { status: v, settled_at: new Date().toISOString() } : {}) };
    }
    t.hist.push(s);
    t.hist = t.hist.filter((o: Snap) => s.at - o.at <= 180000);
    t.pend = t.pend.filter((p: any) => {
      if (s.at !== p.t0) p.trace.push(`suivi ${dump(s)}`);
      if (g !== p.g) { console.log(`[chute rejetée: but] ${p.trace.join(" || ")}`); return false; }
      if (s.at - p.t0 < 45000) return true;
      const n = burst.get(`${bk}|${p.t0}`)?.size || 0;
      p.trace.push(`contrôle : ${n} match(s) en chute dans le même relevé ${NAME[bk]}`);
      // Même match + même ligne déjà signalé par un autre site (ce cycle ou en attente) : doublon, on ne garde que le premier
      const [h1, a1] = p.m.name.split(" - ");
      const dup = [...signals.map((x: any) => ({ lab: x.m?.name, line: x.line, sc: x.sc })), ...pending.filter((x: any) => x.book === "Chute" && Date.now() - new Date(x.created_date).getTime() < 30 * 60e3).map((x: any) => ({ lab: x.match_label, line: x.line, sc: x.score }))]
        .some((x) => sameMatch(x.lab, p.m.name));
      if (dup) console.log(`[chute rejetée: doublon autre site] ${p.m.name} ${label(p.key, 0)}`);
      else if (n < 3) signals.push(p); else console.log(`[chute rejetée: rafale ${n}] ${p.trace.join(" || ")}`);
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
    // Une chute fait souvent glisser plusieurs lignes ensemble (3.5 et 4.5) : on ne garde que la plus basse
    const keys = Object.keys(s.mk).filter((k) => KEY.test(k)).sort((a, b) => parseFloat(a.split("_")[1]) - parseFloat(b.split("_")[1]));
    for (const k of keys) {
      if (t.pend.some((p: any) => p.t0 === s.at) || Object.values(t.last).some((v: any) => s.at - v < 300000)) break;
      const ln = parseFloat(k.split("_")[1]);
      if (ln < g) continue;
      const o0 = odd(base, k), o1 = odd(s, k);
      if (!o0 || !o1) continue;
      const drop = 1 - o1 / o0;
      if (drop < 0.15 || o0 > 4.5 || o1 < 1.3 || o1 > 1.9) continue; // cote finale 1.9 maximum
      // Échelle décalée d'un cran = but déjà intégré par le site, pas une vraie chute
      const lo = odd(base, `TOT_${ln - 1}`), hi = odd(s, `TOT_${ln + 1}`);
      if ((lo && Math.abs(o1 / lo - 1) < 0.1) || (hi && Math.abs(hi / o0 - 1) < 0.1)) continue;
      if (t.last[k] && s.at - t.last[k] < 300000) continue;
      t.last[k] = s.at;
      const bz = `${bk}|${s.at}`; if (!burst.has(bz)) burst.set(bz, new Set()); burst.get(bz)!.add(String(e.id));
      const p = fair(s.mk[k]);
      t.pend.push({
        g, m: t.m, key: k, book: "Chute", side: 0, line: ln, t0: s.at, odd: o1, q: p[0], pref: p[0],
        p0: fair(base.mk[k])[0], edge: drop, min: s.min ?? null, sc: s.sc.join("-"), open_s: sec, followed_s: null, goal: false,
        trace: [`${NAME[bk]} ${label(k, 0)} : ${o0} → ${o1} (−${pct(drop)} %) en ${sec} s`,
          ...h.filter((o: Snap) => o.at >= base.at).map((o: Snap) => `${o === base ? "départ" : o === s ? "chute" : "relevé"} ${dump(o)}`)],
      });
    }
  }

  /** Le match du signal est encore en direct chez l'un de ses sites. */
  const isLive = (sig: any) => Object.entries(IDK).some(([bk, n]) => sig.book_ids?.[n] != null && live[bk]?.has(String(sig.book_ids[n])));
  const count = () => Object.fromEntries(Object.entries(live).map(([bk, s]) => [NAME[bk], { matchs: s.size, avecTotaux: [...T.entries()].filter(([k, t]) => k.startsWith(bk + "|") && Object.keys(t.hist.at(-1)?.mk || {}).some((x) => KEY.test(x))).length }]));
  return { feed, isLive, count };
}