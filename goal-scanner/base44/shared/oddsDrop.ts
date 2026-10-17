import { fair, label } from "./liveMarkets.ts";

// Chutes de cote en direct (observation, aucune mise) — UNIQUEMENT le nombre de buts du match (« plus de X »).
// Une cote perd ≥ 15 % en ~1 min sans but, chez n'importe quel site (1xBet, 1win, betPawa).
// À chaque chute, on note la cote des autres sites au même instant pour voir lequel a bougé le premier.
// Minutes 10e-75e, cote finale 1.30-4. Enregistré comme signal « Chute », réglé au score final.
const KEY = /^TOT_\d+\.5$/;
const BOOKS: [string, string][] = [["x", "1xBet"], ["w", "1win"], ["b", "betPawa"], ["c", "Congobet"], ["y", "Yellowbet"], ["p", "Pinnacle"]];
const pct = (v: number) => Math.round(v * 1000) / 10;
const odd = (s: any, b: string, k: string) => (s[b]?.[k] && !s[b + "l"]?.has(k) ? s[b][k][0] : null);

// Une chute n'est gardée que si AUCUN but ne tombe dans les 45 s qui suivent (sinon c'était un but déjà affiché
// sur un site avant 1xBet, pas un signal) et si tous les sites affichent le même score au moment de la chute.
const CONFIRM_MS = 45000;
const goals = (m: any, s: any) => [s.sc, m.sc?.w, m.sc?.b, m.sc?.c, m.sc?.y, m.sc?.p].filter(Boolean).map((o: any) => o[0] + o[1]);

export function detectDrops(m: any, done: any[]) {
  const h = m.hist || [], s = h[h.length - 1];
  if (!s) return;
  const now = goals(m, s);
  m.dropPend = (m.dropPend || []).filter((p: any) => {
    if (now.some((g: number) => g !== p.g)) return false; // but juste après : faux signal
    if (m.incAt && m.incAt >= p.t0 - 120000) return false; // penalty ou carton rouge autour de la chute
    if (s.at - p.t0 < CONFIRM_MS) return true;
    done.push(p);
    return false;
  });
  if (s.min < 10 || s.min > 75) return;
  if (new Set(now).size > 1) return;
  // Penalty ou carton rouge dans les 2 dernières minutes : la chute a une cause, on ignore
  if (m.incAt && s.at - m.incAt < 120000) return;
  // Marchés de buts 1xBet suspendus = action dangereuse en cours (penalty, VAR) : on ignore
  if (Object.keys(s.x || {}).some((k) => KEY.test(k) && s.xl?.has(k))) return;
  const base = h.find((o: any) => s.at - o.at >= 50000);
  if (!base) return;
  const g = s.sc[0] + s.sc[1];
  // Aucun but dans les 2 dernières minutes : une cote qui chute juste après un but n'est qu'un rattrapage
  if (h.some((o: any) => o.at >= Math.min(base.at, s.at - 120000) && o.sc[0] + o.sc[1] !== g)) return;
  const sec = Math.round((s.at - base.at) / 1000);
  for (const [b, name] of BOOKS) {
    for (const k of Object.keys(s[b] || {})) {
      if (!KEY.test(k) || parseFloat(k.split("_")[1]) < g) continue;
      const o0 = odd(base, b, k), o1 = odd(s, b, k);
      if (!o0 || !o1) continue;
      const drop = 1 - o1 / o0;
      // Cote de départ ≤ 4.5 : une chute de 10 → 3 ne veut rien dire, une chute de 3 → 1.82 est un vrai signal
      if (drop < 0.10 || o0 > 4.5 || o1 < 1.3 || o1 > 2.6) continue;
      // Rattrapage : la cote de départ doit être proche (±15 %) de celle des autres sites au même instant,
      // sinon le site ne fait que se remettre au niveau du marché
      const peers = BOOKS.filter(([ob]) => ob !== b).map(([ob]) => odd(base, ob, k)).filter(Boolean) as number[];
      if (!peers.length) continue;
      const ref = peers.sort((a, z) => a - z)[Math.floor(peers.length / 2)];
      if (Math.abs(o0 / ref - 1) > 0.15) continue;
      // Toute l'échelle décalée d'un cran (nouvelle cote « plus de X+1 » ≈ ancienne « plus de X ») :
      // le site a intégré un but pas encore affiché ailleurs → ce n'est pas une chute normale
      const ln = parseFloat(k.split("_")[1]);
      const lo = odd(base, b, `TOT_${ln - 1}`), hi = odd(s, b, `TOT_${ln + 1}`);
      if ((lo && Math.abs(o1 / lo - 1) < 0.1) || (hi && Math.abs(hi / o0 - 1) < 0.1)) continue;
      const id = "drop" + k; // une seule fiche par ligne de buts, quel que soit le site
      if ((m.last ||= {})[id] && s.at - m.last[id] < 300000) continue;
      m.last[id] = s.at;
      const others = BOOKS.map(([ob, on]) => {
        const a = odd(base, ob, k), z = odd(s, ob, k);
        return `${on} ${a ?? "-"} → ${z ?? "-"}${a && z ? ` (${z < a ? "−" : "+"}${pct(Math.abs(1 - z / a))} %)` : ""}`;
      });
      const p = fair(s[b][k]);
      m.dropPend.push({
        g, m, key: k, bk: b, book: "Chute", side: 0, line: parseFloat(k.split("_")[1]), t0: s.at, odd: o1, q: p[0], pref: p[0],
        p0: fair(base[b][k])[0], edge: drop, min: s.min, sc: s.sc.join("-"), open_s: sec, followed_s: null, goal: false, closed: true,
        trace: [`${name} ${label(k, 0)} : ${o0} → ${o1} (−${pct(drop)} %) en ${sec} s`, ...others],
      });
    }
  }
}