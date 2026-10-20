// Moteur de pression : à partir des compteurs 1xBet (cumulés) relevés en continu et des
// données FotMob, calcule l'intensité des 10 dernières minutes et la probabilité d'un but.
// Repères moyens d'un match : ~1,1 attaque dangereuse/min, ~0,03 but/min.
export type Sample = { at: number; min: number; da: [number, number]; at_: [number, number]; on: [number, number]; off: [number, number]; co: [number, number]; poss: [number, number]; rc: [number, number] };

const GOAL_PER_DA = 0.027, GOAL_PER_ON = 0.3, GOAL_PER_OFF = 0.07;

/** Relevé le plus proche d'il y a `mins` minutes de jeu. */
function ago(h: Sample[], mins: number) {
  const now = h[h.length - 1];
  let best = h[0];
  for (const s of h) if (now.min - s.min >= mins) best = s;
  return best;
}
const d = (a: [number, number], b: [number, number]) => [Math.max(0, a[0] - b[0]), Math.max(0, a[1] - b[1])] as [number, number];

export function compute(h: Sample[], fm: { momentum: { m: number; v: number }[]; shots: any[] } | null, sc: [number, number], odd: number | null, endMin = 94) {
  const now = h[h.length - 1], old = ago(h, 10), o5 = ago(h, 5);
  const span = Math.max(1, now.min - old.min);
  const da10 = d(now.da, old.da), da5 = d(now.da, o5.da), on10 = d(now.on, old.on), off10 = d(now.off, old.off), co10 = d(now.co, old.co), at10 = d(now.at_, old.at_);
  const appm10 = (da10[0] + da10[1]) / span, appm5 = (da5[0] + da5[1]) / Math.max(1, now.min - o5.min);
  const appmMatch = (now.da[0] + now.da[1]) / Math.max(1, now.min);
  // FotMob : xG et momentum des 10 dernières minutes
  const sh10 = (fm?.shots || []).filter((s) => s.m > now.min - 10);
  const xg10 = sh10.length || fm?.shots?.length ? [sh10.filter((s) => s.home).reduce((a, s) => a + s.xg, 0), sh10.filter((s) => !s.home).reduce((a, s) => a + s.xg, 0)] : null;
  const mom = (fm?.momentum || []).filter((p) => p.m > now.min - 10);
  const mom10 = mom.length ? mom.reduce((a, p) => a + p.v, 0) / mom.length : null;
  // Estimations du nombre de buts sur 10 min (rythme récent ramené à 10 min)
  const k = 10 / span;
  const lDa = (da10[0] + da10[1]) * GOAL_PER_DA * k;
  const lSh = ((on10[0] + on10[1]) * GOAL_PER_ON + (off10[0] + off10[1]) * GOAL_PER_OFF) * k;
  let l10 = xg10 ? 0.4 * (xg10[0] + xg10[1]) * k + 0.3 * lDa + 0.3 * lSh : 0.5 * lDa + 0.5 * lSh;
  if (mom10 != null) l10 *= 1 + Math.min(Math.abs(mom10), 60) / 200;
  const diff = Math.abs(sc[0] - sc[1]);
  if (now.min >= 75 && diff <= 1) l10 *= 1.15; // l'équipe menée ou à égalité doit attaquer
  if (now.rc[0] + now.rc[1] > 0) l10 *= 1.1;
  const rest = Math.max(2, endMin - now.min);
  const prob10 = 1 - Math.exp(-l10), prob = 1 - Math.exp(-l10 * rest / 10);
  const shareH = (da10[0] + da10[1]) ? da10[0] / (da10[0] + da10[1]) : 0.5;
  const side = shareH >= 0.65 ? "domicile" : shareH <= 0.35 ? "exterieur" : "les_deux";
  const r = (x: number, n = 2) => Math.round(x * 10 ** n) / 10 ** n;
  return {
    span: r(span, 0), appm10: r(appm10), appm5: r(appm5), appmMatch: r(appmMatch), rising: appm10 > appmMatch * 1.25,
    da10, da5, att10: at10, on10, off10, co10, poss: now.poss, red: now.rc,
    xg10: xg10 ? xg10.map((x) => r(x)) : null, mom10: mom10 == null ? null : r(mom10, 0), fotmob: !!fm,
    goals10: r(l10), prob10: r(prob10 * 100, 0), prob: r(prob * 100, 0), side, shareH: r(shareH * 100, 0),
    odd, value: odd ? r((odd * prob - 1) * 100, 0) : null,
  };
}

/** Deux fenêtres de trading : surveillance dès la 30e (fin de 1re MT) et dès la 65e (fin de match). */
export const watchWindow = (min: number) => (min >= 30 && min <= 45) || (min >= 65 && min <= 88);
export const periodOf = (min: number) => (min <= 45 ? "mt1" : "fin");

/** Règles d'alerte (observation) : 35e–44e (but avant la pause) ou 75e–88e (but avant la fin),
 *  pression récente forte et en hausse, cote qui paie. */
export function isSignal(min: number, m: ReturnType<typeof compute>) {
  const inAlert = (min >= 35 && min <= 44) || (min >= 75 && min <= 88);
  return inAlert && m.span >= 5 && m.appm10 >= 1.0 && m.rising && m.prob >= 50 && !!m.odd && m.odd >= 1.4 && (m.value ?? 0) >= 8;
}