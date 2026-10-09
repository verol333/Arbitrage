import { fair, label, type Mk } from "../../shared/liveMarkets.ts";

// Scanner « probabilités en avance » : 1xBet (marge retirée) sert de référence.
// Signal = la probabilité juste 1xBet d'une issue « buts » gagne au moins 10 points et atteint 60 % en
// ≤ 3,5 s, sans but récent, alors qu'un autre site n'a pas bougé et paie ≥ 5 % d'avantage.
// Un mouvement brusque en 3 s n'est pas l'usure du temps (qui fait ~0,1 point/s au plus).
export type Snap = { at: number; sc: [number, number]; min: number; x: Mk; xl: Set<string>; w?: Mk | null; wl?: Set<string>; b?: Mk | null; bl?: Set<string>; c?: Mk | null; cl?: Set<string> };
const KEY = /^(TOT|ITH|ITA)_\d+\.5$/;
const BOOKS = [["w", "1win"], ["b", "betPawa"], ["c", "Congobet"]] as const;
const goalsFor = (k: string, sc: [number, number]) => k.startsWith("ITH") ? sc[0] : k.startsWith("ITA") ? sc[1] : sc[0] + sc[1];
const pct = (v: number) => Math.round(v * 1000) / 10;

// Compteurs du cycle : où les mouvements 1xBet sont écartés (visible dans le journal du scanner)
export const STATS = { lignes: 0, mouvements1xbet: 0, absentAilleurs: 0, dejaSuivi: 0, coteHorsZone: 0, avantageFaible: 0 };

export function step(m: any, s: Snap, done: any[]) {
  const h: Snap[] = (m.hist ||= []);
  h.push(s);
  while (h.length && s.at - h[0].at > 65000) h.shift();
  m.pend ||= [];
  for (const p of m.pend) follow(p, s);
  done.push(...m.pend.filter((p: any) => p.closed));
  m.pend = m.pend.filter((p: any) => !p.closed);

  if (s.min < 10 || s.min > 85) return;
  const g = s.sc[0] + s.sc[1];
  // Aucune influence d'un but : 60 s d'historique sans changement de score, et tous les sites d'accord
  // 30 s sans but (au lieu de 60 s, qui laissait à peine une minute utile par cycle)
  if (s.at - h[0].at < 30000 || h.slice(-30).some((o) => o.sc[0] + o.sc[1] !== g)) return;
  for (const o of [m.sc?.w, m.sc?.b, m.sc?.c]) if (o && o[0] + o[1] !== g) return;

  for (const k of Object.keys(s.x)) {
    const tot = KEY.test(k);
    if ((!tot && k !== "1X2" && k !== "BTTS") || s.xl.has(k)) continue;
    // BTTS déjà acquis (les deux ont marqué) : plus rien à lire
    if (k === "BTTS" && s.sc[0] > 0 && s.sc[1] > 0) continue;
    // Référence : dernière cote 1xBet ouverte dans les 10 s précédentes. Les gros mouvements
    // arrivent souvent juste après une suspension (action dangereuse) : on compare à la cote d'avant.
    const base = h.find((o) => s.at - o.at <= 10000 && s.at - o.at >= 900 && o.x[k] && !o.xl.has(k));
    if (!base) continue;
    const line = tot ? parseFloat(k.split("_")[1]) : 0;
    // Lignes réalistes seulement : le prochain but ou le suivant (ex. à 1-0 : plus/moins 1.5 et 2.5)
    if (tot && (line < goalsFor(k, s.sc) || line - goalsFor(k, s.sc) > 1.5)) continue;
    if (base.x[k].length !== s.x[k].length) continue;
    const p0 = fair(base.x[k]), p1 = fair(s.x[k]);
    // Issue qui a le plus gagné en probabilité chez 1xBet (2 ou 3 issues)
    let side = 0;
    for (let i = 1; i < p1.length; i++) if (p1[i] - p0[i] > p1[side] - p0[side]) side = i;
    STATS.lignes++;
    // Seulement les vrais sauts : +10 points au moins, et 1xBet donne l'issue à 60 % ou plus (ex. 45 → 60 %)
    if (p1[side] - p0[side] < 0.10 || p1[side] < 0.60) continue;
    STATS.mouvements1xbet++;
    for (const [bk, name] of BOOKS) {
      const mk = (s as any)[bk] as Mk | null, mk0 = (base as any)[bk] as Mk | null, lk = (s as any)[bk + "l"] as Set<string> | undefined;
      if (!mk?.[k] || !mk0?.[k] || lk?.has(k) || mk[k].length !== p1.length) { STATS.absentAilleurs++; continue; }
      const id = k + bk;
      if ((m.last ||= {})[id] && s.at - m.last[id] < 60000) continue;
      const q0 = fair(mk0[k])[side], q1 = fair(mk[k])[side];
      if (Math.abs(q1 - q0) >= 0.01) { STATS.dejaSuivi++; continue; } // le site a déjà bougé
      const odd = mk[k][side], edge = odd * p1[side] - 1;
      // Cotes jouables : entre 1,30 et 3,00 (probabilité ~33 % à ~77 %), pas de cotes à 5 ou 8
      if (odd < 1.3 || odd > 3) { STATS.coteHorsZone++; continue; }
      if (edge < 0.05) { STATS.avantageFaible++; continue; }
      m.last[id] = s.at;
      m.pend.push({
        m, key: k, bk, book: name, side, line, t0: s.at, odd, q: q1, pref: p1[side], p0: p0[side], edge,
        min: s.min, sc: s.sc.join("-"), open_s: 0, followed_s: null, goal: false, closed: false, trace: [], g,
      });
    }
  }
}

function follow(p: any, s: Snap) {
  const t = Math.round((s.at - p.t0) / 100) / 10;
  const o = ((s as any)[p.bk] as Mk | null)?.[p.key];
  const locked = ((s as any)[p.bk + "l"] as Set<string> | undefined)?.has(p.key);
  const xr = s.x[p.key] ? `${pct(fair(s.x[p.key])[p.side])}%` : "-";
  if (p.trace.length < 40) p.trace.push(`+${t}s | 1xBet ${xr} | ${p.book} ${!o ? "absent" : locked ? "bloqué" : `@${o[p.side]} (${pct(fair(o)[p.side])}%)`}`);
  if (s.sc[0] + s.sc[1] !== p.g) { p.goal = true; p.closed = true; return; }
  const moved = !o || locked || Math.abs(fair(o)[p.side] - p.q) >= 0.015;
  if (moved) { p.followed_s = t; p.closed = true; } else p.open_s = t;
  if (t >= 30) p.closed = true;
}

export function toSignal(p: any, runId: string) {
  return {
    run_id: runId, xbet_id: p.m.x, match_label: p.m.name, league: p.m.league, minute: p.min, score: p.sc,
    market_key: p.key, market_label: label(p.key, p.side), line: p.line, side: p.key === "1X2" ? ["1", "X", "2"][p.side] : p.key === "BTTS" ? ["oui", "non"][p.side] : p.side ? "moins" : "plus", book: p.book,
    ref_prob_before: pct(p.p0), ref_prob_after: pct(p.pref), book_prob: pct(p.q), book_odd: p.odd, edge_pct: pct(p.edge),
    open_s: p.open_s, followed_s: p.followed_s, goal_during: p.goal, timeline: p.trace, status: "pending",
    last_score: p.sc, last_minute: p.min,
  };
}

/** Issue d'un signal selon un score : gagné/perdu dès que la ligne est dépassée, sinon à la fin du match. */
export function verdict(sig: any, sc: [number, number], final: boolean) {
  if (sig.market_key === "1X2") return final ? ((sc[0] > sc[1] ? "1" : sc[0] < sc[1] ? "2" : "X") === sig.side ? "won" : "lost") : null;
  if (sig.market_key === "BTTS") {
    const both = sc[0] > 0 && sc[1] > 0;
    if (both) return sig.side === "oui" ? "won" : "lost";
    return final ? (sig.side === "oui" ? "lost" : "won") : null;
  }
  const over = goalsFor(sig.market_key, sc) > sig.line;
  if (over) return sig.side === "plus" ? "won" : "lost";
  return final ? (sig.side === "plus" ? "lost" : "won") : null;
}