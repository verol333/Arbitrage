// ═══════════════════════════════════════════════════════════════════
// RÉSOLUTION MUTUALISÉE DES SÉLECTIONS.
//
// Pourquoi ce fichier existe :
//   Retrouver une sélection chez un bookmaker (identifiant de marché + cote
//   fraîche) ne dépend PAS du compte qui parie. Pour une même opportunité,
//   1 utilisateur ou 10 000 utilisateurs ont exactement la même sélection,
//   le même identifiant, la même cote.
//
//   Or le moteur appelait `adapter.resolve()` pour CHAQUE utilisateur : à
//   1 000 comptes, c'était 1 000 fois le même appel réseau vers 1win ou
//   Apollo — la vraie cause de la latence et le meilleur moyen de se faire
//   couper l'accès par les bookmakers.
//
//   Ici, la résolution est faite UNE FOIS et partagée. Les appels concurrents
//   qui arrivent pendant qu'une résolution est en vol attendent la même
//   réponse au lieu d'en déclencher une nouvelle (déduplication).
//
// Fraîcheur : la cote doit rester juste, donc la durée de validité est courte
// et dépend du rythme du marché — 2 s en live (les cotes bougent à la
// seconde), 15 s en pré-match (elles sont stables).
// ═══════════════════════════════════════════════════════════════════

import type { BookAdapter, ResolveResult } from "./autoBookAdapters.ts";

export const LIVE_TTL_MS = 2000;
export const PREMATCH_TTL_MS = 15000;

export const ttlFor = (isLive: unknown) => (isLive ? LIVE_TTL_MS : PREMATCH_TTL_MS);

interface Entry {
  at: number;
  promise: Promise<ResolveResult>;
}

const cache = new Map<string, Entry>();
const MAX_ENTRIES = 400;

/** Compteurs d'observation (exposés pour les tests de charge). */
export const resolveStats = { calls: 0, networkCalls: 0, hits: 0 };

function prune(now: number) {
  for (const [k, e] of cache) {
    if (now - e.at > PREMATCH_TTL_MS) cache.delete(k);
  }
  if (cache.size > MAX_ENTRIES) {
    // Purge des plus anciennes entrées si le cache déborde.
    const sorted = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [k] of sorted.slice(0, cache.size - MAX_ENTRIES)) cache.delete(k);
  }
}

/**
 * Résout une sélection avec mutualisation. Signature identique à
 * `adapter.resolve`, plus la durée de validité voulue.
 */
export function cachedResolve(
  book: string,
  ad: BookAdapter,
  opp: Record<string, any>,
  coupon: Record<string, any> | null,
  matchId: unknown,
  label: string,
  ttlMs: number,
  ctx?: { host?: string },
): Promise<ResolveResult> {
  // ⚠️ Le site du compte fait PARTIE de la clé : betPawa a un catalogue et des
  // prix par pays. Sans cela, un compte camerounais héritait de la sélection
  // lue sur le site congolais et la voyait refusée « hors ligne » à la pose.
  const key = [book, ctx?.host || "", String(matchId ?? ""), String(opp.market_family ?? ""), String(label ?? "")].join("|");
  const now = Date.now();
  resolveStats.calls++;

  const hit = cache.get(key);
  if (hit && now - hit.at < ttlMs) {
    resolveStats.hits++;
    return hit.promise;
  }

  resolveStats.networkCalls++;
  const promise = ad.resolve(opp, coupon, matchId, label, ctx);
  cache.set(key, { at: now, promise });
  prune(now);

  // Une exception ne doit pas rester en cache : sinon tous les comptes
  // suivants héritent de l'échec au lieu de retenter.
  promise.catch(() => {
    const cur = cache.get(key);
    if (cur && cur.promise === promise) cache.delete(key);
  });

  return promise;
}

/** Vide le cache — utilisé par les tests de simulation. */
export function resetResolveCache() {
  cache.clear();
  resolveStats.calls = 0;
  resolveStats.networkCalls = 0;
  resolveStats.hits = 0;
}