import { fair, label } from "./liveMarkets.ts";

// Chutes de cote en direct (observation, aucune mise) : une issue 1xBet perd ≥ 15 % de cote en ~1 min
// sans but ni changement de score. L'usure normale du temps (≈ 1-2 %/min) est écartée :
// pas de « moins de » (qui baisse seul avec le temps), minutes 10e-75e, cote finale 1.30-4.
// Enregistré comme signal « Chute » (book = "Chute") : réglé au score final par le scanner.
const KEY = /^(TOT|ITH|ITA)_\d+\.5$/;
const goalsFor = (k: string, sc: [number, number]) => k.startsWith("ITH") ? sc[0] : k.startsWith("ITA") ? sc[1] : sc[0] + sc[1];
const pct = (v: number) => Math.round(v * 1000) / 10;

export function detectDrops(m: any, done: any[]) {
  const h = m.hist || [], s = h[h.length - 1];
  if (!s || s.min < 10 || s.min > 75) return;
  const base = h.find((o: any) => s.at - o.at >= 50000);
  if (!base) return;
  const g = s.sc[0] + s.sc[1];
  if (h.some((o: any) => o.at >= base.at && o.sc[0] + o.sc[1] !== g)) return;
  for (const k of Object.keys(s.x)) {
    const tot = KEY.test(k);
    if ((!tot && k !== "1X2" && k !== "BTTS") || s.xl.has(k) || !base.x[k] || base.xl.has(k) || base.x[k].length !== s.x[k].length) continue;
    const line = tot ? parseFloat(k.split("_")[1]) : 0;
    if (tot && line < goalsFor(k, s.sc)) continue;
    for (let side = 0; side < s.x[k].length; side++) {
      if (tot && side === 1) continue;
      if (k === "BTTS" && side === 1) continue;
      const o0 = base.x[k][side], o1 = s.x[k][side], drop = 1 - o1 / o0;
      if (drop < 0.15 || o1 < 1.3 || o1 > 4) continue;
      const id = "drop" + k + side;
      if ((m.last ||= {})[id] && s.at - m.last[id] < 300000) continue;
      m.last[id] = s.at;
      const p1 = fair(s.x[k])[side], books = [["w", "1win"], ["b", "betPawa"]].map(([b, n]) => {
        const mk = s[b]?.[k]; return mk && !s[b + "l"]?.has(k) ? `${n} @${mk[side]}` : `${n} -`;
      });
      done.push({
        m, key: k, bk: "x", book: "Chute", side, line, t0: s.at, odd: o1, q: p1, pref: p1, p0: fair(base.x[k])[side],
        edge: drop, min: s.min, sc: s.sc.join("-"), open_s: Math.round((s.at - base.at) / 1000), followed_s: null, goal: false, closed: true,
        trace: [`1xBet ${label(k, side)} : ${o0} → ${o1} (−${pct(drop)} %) en ${Math.round((s.at - base.at) / 1000)} s`, `Au même instant : ${books.join(" · ")}`],
      });
    }
  }
}