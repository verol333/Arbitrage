// Moteur de pression : à partir des compteurs 1xBet (cumulés) relevés en continu, des données FotMob
// et du mouvement de la cote, calcule l'intensité des 10 dernières minutes, la probabilité d'un but
// et une note de fiabilité (étoiles) selon le nombre de signaux qui convergent.
// Repères moyens d'un match : ~1,1 attaque dangereuse/min, ~0,03 but/min.
export type Sample = {
  at: number; min: number; da: [number, number]; at_: [number, number]; on: [number, number]; off: [number, number];
  co: [number, number]; poss: [number, number]; rc: [number, number]; yc?: [number, number]; pen?: [number, number];
};

const GOAL_PER_DA = 0.027, GOAL_PER_ON = 0.3, GOAL_PER_OFF = 0.07, GOAL_PER_CO = 0.03, GOAL_PER_AT = 0.004;

/** Relevé le plus proche d'il y a `mins` minutes de jeu. */
function ago(h: Sample[], mins: number) {
  const now = h[h.length - 1];
  let best = h[0];
  for (const s of h) if (now.min - s.min >= mins) best = s;
  return best;
}
const z2: [number, number] = [0, 0];
const d = (a: [number, number] = z2, b: [number, number] = z2) => [Math.max(0, a[0] - b[0]), Math.max(0, a[1] - b[1])] as [number, number];
const sum = (x: [number, number]) => x[0] + x[1];

/** Les signaux qui doivent converger. Chaque ligne = 1 point vers les étoiles. */
export const CHECKS: Record<string, string> = {
  intensite: "Attaques dangereuses fortes (≥ 1/min)",
  hausse: "Intensité en hausse vs le reste du match",
  acceleration: "Accélération sur les 5 dernières minutes",
  tirs_cadres: "≥ 2 tirs cadrés en 10 min",
  tirs: "≥ 4 tirs en 10 min",
  corners: "≥ 2 corners en 10 min",
  attaques: "≥ 8 attaques en 10 min",
  domination: "Une équipe écrase l'autre (≥ 65 % des attaques dangereuses)",
  possession: "L'équipe qui pousse a le ballon (≥ 55 %)",
  xg: "xG ≥ 0,4 en 10 min ou grosse occasion",
  momentum: "Momentum FotMob fort (≥ 25)",
  score: "Score serré (écart ≤ 1)",
  cote: "La cote du but baisse : le marché y croit aussi",
  incident: "Penalty ou carton rouge récent",
};

export function compute(h: Sample[], fm: { momentum: { m: number; v: number }[]; shots: any[] } | null, sc: [number, number], odd: number | null, endMin = 94, oddDrop: number | null = null) {
  const now = h[h.length - 1], old = ago(h, 10), o5 = ago(h, 5);
  const span = Math.max(1, now.min - old.min);
  const da10 = d(now.da, old.da), da5 = d(now.da, o5.da), on10 = d(now.on, old.on), off10 = d(now.off, old.off), co10 = d(now.co, old.co), at10 = d(now.at_, old.at_);
  const rc10 = d(now.rc, old.rc), pen10 = d(now.pen, old.pen);
  const appm10 = sum(da10) / span, appm5 = sum(da5) / Math.max(1, now.min - o5.min);
  const appmMatch = sum(now.da) / Math.max(1, now.min);
  // FotMob : xG, grosses occasions et momentum des 10 dernières minutes
  const sh10 = (fm?.shots || []).filter((s) => s.m > now.min - 10);
  const xg10 = sh10.length || fm?.shots?.length ? [sh10.filter((s) => s.home).reduce((a, s) => a + s.xg, 0), sh10.filter((s) => !s.home).reduce((a, s) => a + s.xg, 0)] : null;
  const big10 = sh10.filter((s) => s.xg >= 0.3 && !s.goal).length;
  const mom = (fm?.momentum || []).filter((p) => p.m > now.min - 10);
  const mom10 = mom.length ? mom.reduce((a, p) => a + p.v, 0) / mom.length : null;
  // Estimation du nombre de buts sur 10 min (rythme récent ramené à 10 min)
  const k = 10 / span;
  const lDa = sum(da10) * GOAL_PER_DA * k;
  const lSh = (sum(on10) * GOAL_PER_ON + sum(off10) * GOAL_PER_OFF + sum(co10) * GOAL_PER_CO + sum(at10) * GOAL_PER_AT) * k;
  let l10 = xg10 ? 0.4 * (xg10[0] + xg10[1]) * k + 0.3 * lDa + 0.3 * lSh : 0.5 * lDa + 0.5 * lSh;
  if (mom10 != null) l10 *= 1 + Math.min(Math.abs(mom10), 60) / 200;
  const diff = Math.abs(sc[0] - sc[1]);
  if (now.min >= 75 && diff <= 1) l10 *= 1.15; // l'équipe menée ou à égalité doit attaquer
  if (now.rc[0] + now.rc[1] > 0) l10 *= 1.1;
  const rest = Math.max(2, endMin - now.min);
  const prob10 = 1 - Math.exp(-l10), prob = 1 - Math.exp(-l10 * rest / 10);
  const shareH = sum(da10) ? da10[0] / sum(da10) : 0.5;
  const side = shareH >= 0.65 ? "domicile" : shareH <= 0.35 ? "exterieur" : "les_deux";
  const pushPoss = side === "domicile" ? now.poss[0] : side === "exterieur" ? now.poss[1] : 0;
  // Convergence des signaux
  const ok: Record<string, boolean> = {
    intensite: appm10 >= 1.0,
    hausse: appm10 > appmMatch * 1.25,
    acceleration: appm5 >= appm10 * 1.1,
    tirs_cadres: sum(on10) >= 2,
    tirs: sum(on10) + sum(off10) >= 4,
    corners: sum(co10) >= 2,
    attaques: sum(at10) >= 8,
    domination: side !== "les_deux",
    possession: pushPoss >= 55,
    xg: (xg10 ? xg10[0] + xg10[1] >= 0.4 : false) || big10 > 0,
    momentum: mom10 != null && Math.abs(mom10) >= 25,
    score: diff <= 1,
    cote: oddDrop != null && oddDrop >= 0.05,
    incident: sum(rc10) + sum(pen10) > 0,
  };
  const passed = Object.keys(ok).filter((x) => ok[x]);
  const n = passed.length;
  const stars = n >= 10 ? 5 : n >= 8 ? 4 : n >= 6 ? 3 : n >= 4 ? 2 : 1;
  const r = (x: number, p = 2) => Math.round(x * 10 ** p) / 10 ** p;
  return {
    span: r(span, 0), appm10: r(appm10), appm5: r(appm5), appmMatch: r(appmMatch), rising: ok.hausse,
    da10, da5, att10: at10, on10, off10, co10, poss: now.poss, red: now.rc, yc: now.yc || null, pen10,
    xg10: xg10 ? xg10.map((x) => r(x)) : null, big10, mom10: mom10 == null ? null : r(mom10, 0), fotmob: !!fm,
    odd_drop: oddDrop == null ? null : r(oddDrop),
    goals10: r(l10), prob10: r(prob10 * 100, 0), prob: r(prob * 100, 0), side, shareH: r(shareH * 100, 0),
    odd, value: odd ? r((odd * prob - 1) * 100, 0) : null,
    checks: passed, checks_total: Object.keys(ok).length, stars,
  };
}

/** Deux fenêtres de trading : surveillance dès la 30e (fin de 1re MT) et dès la 65e (fin de match). */
export const watchWindow = (min: number) => (min >= 30 && min <= 45) || (min >= 75 && min <= 90);
export const periodOf = (min: number) => (min <= 45 ? "mt1" : "fin");

/** Règles d'alerte (observation) : 35e–44e ou 75e–88e, au moins 3 étoiles (6 signaux sur 14),
 *  intensité forte, probabilité ≥ 50 %, cote qui paie. */
export function isSignal(min: number, m: ReturnType<typeof compute>) {
  // Fin de match uniquement, et seulement des indicateurs de poussée (pas de pourcentage fixe)
  const inAlert = min >= 85 && min <= 93;
  return inAlert && m.span >= 5 && m.stars >= 3 && m.checks.includes("intensite") && !!m.odd && m.odd >= 1.4;
}