// ═══════════════════════════════════════════════════════════════════
// 1WIN — RETROUVER UN MATCH PAR LES NOMS D'ÉQUIPES.
//
// Pourquoi : quand une jambe reste à découvert, le rattrapage cherche la
// couverture chez les autres bookmakers connectés. Or il n'avait que les
// identifiants des deux books du surebet : le repli 1win échouait
// systématiquement sur « Identifiant de match 1win absent de l'opportunité »
// (constaté les 07 et 08/09/2026 sur les trois positions à découvert), alors
// que le match était bel et bien coté chez 1win.
//
// On retrouve donc le match par ses deux équipes, exactement comme betPawa le
// fait déjà (findBetpawaEventId). La liste est mise en cache 3 minutes : le
// rattrapage la sollicite plusieurs fois d'affilée.
// ═══════════════════════════════════════════════════════════════════

import { listOnewin, type OnewinMatch } from "./onewinLadder.ts";
import { sameOpponents } from "./teamMatch.ts";

const CACHE_MS = 180_000;
let cache: { at: number; rows: OnewinMatch[] } | null = null;

async function matches(): Promise<OnewinMatch[]> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.rows;
  // Fenêtre : matchs déjà commencés (live) jusqu'à 3 jours à venir.
  const rows = await listOnewin(now - 4 * 3600_000, now + 3 * 86_400_000).catch(() => [] as OnewinMatch[]);
  if (rows.length) cache = { at: now, rows };
  return rows;
}

/** Identifiant 1win du match opposant `home` à `away`, ou null. */
export async function findOnewinMatchId(home: string, away: string): Promise<number | null> {
  if (!home || !away) return null;
  const rows = await matches();
  const hit = rows.find((m) => sameOpponents(m.home, m.away, home, away) === true);
  return hit ? hit.id : null;
}