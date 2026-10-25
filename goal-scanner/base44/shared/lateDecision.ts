// Décision 85e–90e : note d'avant-match + situation réelle du match → on se jette sur « +1 but » ou pas.
const THRESHOLD = 75;

export function lateDecision(sel: any, sc: [number, number], m: any, s85: any, red: [number, number] | null) {
  const ctx = sel?.ctx || {};
  const diff = sc[0] - sc[1];
  if (Math.abs(diff) >= 2) return { go: false, why: "écart de 2 buts" };
  // Qui a besoin du but : l'équipe menée ; à égalité, celle qui a un enjeu ou le favori
  const stakeOf = (k: string) => (k === "domicile" ? ctx.home : ctx.away)?.stake || "aucun";
  let need = diff < 0 ? "domicile" : diff > 0 ? "exterieur" : null;
  if (!need) need = stakeOf("domicile") !== "aucun" && stakeOf("exterieur") === "aucun" ? "domicile" : stakeOf("exterieur") !== "aucun" && stakeOf("domicile") === "aucun" ? "exterieur" : ctx.fav || null;
  if (!need) return { go: false, why: "personne n'a besoin du but" };
  if (m.side !== need) return { go: false, why: "ce n'est pas l'équipe qui a besoin du but qui pousse" };
  // Garde-fou : l'équipe qui mène gère (peu d'indicateurs de poussée)
  if ((m.checks || []).length < 3) return { go: false, why: "le match est géré, pas de vraie poussée" };
  const p: Record<string, number> = { avant_match: sel.score };
  const favNeed = ctx.fav === need;
  if (favNeed) p.favori_en_difficulte = 10;
  if (stakeOf(need) !== "aucun") p.enjeu = 8;
  const mom = s85?.mom_70_85;
  if (mom != null && (need === "domicile" ? mom : -mom) > 20) p.momentum = 6;
  const subs = s85?.off_subs?.[need] || 0;
  if (subs) p.changements_offensifs = Math.min(10, subs * 5);
  const added = s85?.added_time;
  if (added >= 6) p.temps_additionnel = 8; else if (added >= 4) p.temps_additionnel = 4;
  if (red) { const [mine, opp] = need === "domicile" ? red : [red[1], red[0]]; if (opp > mine) p.rouge_adverse = 6; if (mine > opp) p.rouge_pour_nous = -15; }
  if ((m.checks || []).includes("intensite")) p.intensite = 8;
  const total = Math.round(Object.values(p).reduce((s, v) => s + v, 0));
  return { go: total >= THRESHOLD, total, need, parts: p, why: total >= THRESHOLD ? "ok" : "note trop basse" };
}