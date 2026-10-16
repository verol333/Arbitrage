import { fair, label } from "./liveMarkets.ts";

// Chutes de cote en direct (observation, aucune mise) — UNIQUEMENT le nombre de buts du match (« plus de X »).
// Une cote perd ≥ 15 % en ~1 min sans but, chez n'importe quel site (1xBet, 1win, betPawa).
// À chaque chute, on note la cote des autres sites au même instant pour voir lequel a bougé le premier.
// Minutes 10e-75e, cote finale 1.30-4. Enregistré comme signal « Chute », réglé au score final.
const KEY = /^TOT_\d+\.5$/;
const BOOKS: [string, string][] = [["x", "1xBet"], ["w", "1win"], ["b", "betPawa"], ["c", "Congobet"], ["y", "Yellowbet"], ["p", "Pinnacle"]];
const pct = (v: number) => Math.round(v * 1000) / 10;
const odd = (s: any, b: string, k: string) => (s[b]?.[k] && !s[b + "l"]?.has(k) ? s[b][k][0] : null);

export function detectDrops(m: any, done: any[]) {
  const h = m.hist || [], s = h[h.length - 1];
  if (!s || s.min < 10 || s.min > 75) return;
  const base = h.find((o: any) => s.at - o.at >= 50000);
  if (!base) return;
  const g = s.sc[0] + s.sc[1];
  if (h.some((o: any) => o.at >= base.at && o.sc[0] + o.sc[1] !== g)) return;
  const sec = Math.round((s.at - base.at) / 1000);
  for (const [b, name] of BOOKS) {
    for (const k of Object.keys(s[b] || {})) {
      if (!KEY.test(k) || parseFloat(k.split("_")[1]) < g) continue;
      const o0 = odd(base, b, k), o1 = odd(s, b, k);
      if (!o0 || !o1) continue;
      const drop = 1 - o1 / o0;
      if (drop < 0.15 || o1 < 1.3 || o1 > 4) continue;
      const id = "drop" + k; // une seule fiche par ligne de buts, quel que soit le site
      if ((m.last ||= {})[id] && s.at - m.last[id] < 300000) continue;
      m.last[id] = s.at;
      const others = BOOKS.map(([ob, on]) => {
        const a = odd(base, ob, k), z = odd(s, ob, k);
        return `${on} ${a ?? "-"} → ${z ?? "-"}${a && z ? ` (${z < a ? "−" : "+"}${pct(Math.abs(1 - z / a))} %)` : ""}`;
      });
      const p = fair(s[b][k]);
      done.push({
        m, key: k, bk: b, book: "Chute", side: 0, line: parseFloat(k.split("_")[1]), t0: s.at, odd: o1, q: p[0], pref: p[0],
        p0: fair(base[b][k])[0], edge: drop, min: s.min, sc: s.sc.join("-"), open_s: sec, followed_s: null, goal: false, closed: true,
        trace: [`${name} ${label(k, 0)} : ${o0} → ${o1} (−${pct(drop)} %) en ${sec} s`, ...others],
      });
    }
  }
}