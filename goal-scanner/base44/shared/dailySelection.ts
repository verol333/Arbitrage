// Sélection du jour (avant les matchs) : fiche d'avant-match FotMob de chaque match des championnats suivis,
// note de potentiel « but tardif » sur 100, et seuls les meilleurs matchs sont suivis en direct.
import { sameTeam } from "./teamMatch.ts";
import { matchContext } from "./matchContext.ts";
import { lateProfile } from "./lateGoals.ts";

const H = { "user-agent": "Mozilla/5.0 Chrome/120", accept: "application/json" };
// Championnats avec assez de données (FotMob : classement, confrontations, forme)
const LEAGUES = new Set([47, 48, 108, 109, 87, 140, 54, 146, 55, 86, 53, 110, 57, 61, 40, 71, 64, 42, 73, 10216, 268, 112, 130, 230, 46, 59, 67, 69, 38, 135, 122, 8968, 9067]);
const TOP = 20, MIN_SCORE = 55;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Note d'avant-match sur 100 + détail par critère (null si les données sont insuffisantes). */
export function prematchScore(ctx: any, late: any) {
  if (!ctx?.home || !ctx?.away || !ctx.form?.home || !ctx.form?.away || !late?.home?.n || !late?.away?.n) return null;
  const parts: Record<string, number> = {};
  parts.championnat = ctx.league_avg_goals ? clamp((ctx.league_avg_goals - 2.6) * 15, -12, 12) : 0;
  const fg = (ctx.form.home.scored + ctx.form.home.conceded + ctx.form.away.scored + ctx.form.away.conceded) / 2;
  parts.forme = clamp((fg - 2.6) * 8, -10, 10);
  parts.confrontations = !ctx.h2h || ctx.h2h.n < 3 ? 0 : ctx.h2h.avg_goals >= 3 ? 10 : ctx.h2h.avg_goals >= 2.5 ? 5 : ctx.h2h.avg_goals < 2 ? -8 : 0;
  const lateN = late.home.n + late.away.n;
  parts.buts_tardifs = clamp(((late.home.scored + late.home.conceded + late.away.scored + late.away.conceded) / lateN) * 30 - 8, -8, 22);
  parts.enjeu = [ctx.home, ctx.away].filter((t: any) => t.stake && t.stake !== "aucun").length * 8;
  parts.favori = ctx.fav ? 5 : 0;
  const score = Math.round(clamp(45 + Object.values(parts).reduce((s, v) => s + v, 0), 0, 100));
  return { score, parts };
}

let SEL = { day: "", at: 0, list: [] as any[] };

/** Construit (ou relit) la sélection du jour. Rafraîchie toutes les 3 h. */
export async function dailySelection(save?: (list: any[]) => Promise<any>) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  if (SEL.day === day && Date.now() - SEL.at < 3 * 3600e3) return SEL.list;
  const j = await fetch(`https://www.fotmob.com/api/data/matches?date=${day}`, { headers: H, signal: AbortSignal.timeout(10000) }).then((r) => r.json()).catch(() => null);
  if (!j?.leagues) return SEL.list;
  const cand = j.leagues.filter((l: any) => LEAGUES.has(Number(l.primaryId ?? l.id)))
    .flatMap((l: any) => (l.matches || []).map((m: any) => ({ ...m, league: l.name })))
    .filter((m: any) => !m.status?.finished && !m.status?.cancelled);
  const out: any[] = [];
  for (let k = 0; k < cand.length; k += 4) {
    await Promise.all(cand.slice(k, k + 4).map(async (m: any) => {
      const [ctx, late] = await Promise.all([matchContext(m.id).catch(() => null), lateProfile(m.id).catch(() => null)]);
      const p = prematchScore(ctx, late);
      if (p) out.push({ fotmob: m.id, home: m.home?.name, away: m.away?.name, league: m.league, kickoff: m.status?.utcTime, score: p.score, parts: p.parts, ctx, late });
    }));
  }
  const list = out.filter((m) => m.score >= MIN_SCORE).sort((a, b) => b.score - a.score).slice(0, TOP);
  SEL = { day, at: Date.now(), list };
  if (save) await save(list.map(({ ctx, late, ...r }) => r)).catch(() => null);
  return list;
}

/** Le match 1xBet fait-il partie de la sélection du jour ? */
export const selected = (home: string, away: string) => SEL.list.find((m) => sameTeam(m.home, home) && sameTeam(m.away, away)) || null;