// ═══════════════════════════════════════════════════════════════════
// CONGOBET — résolution EXACTE d'une sélection juste avant de miser.
//
// Le scanner nous donne `eventBetTypeItemId` (l'identifiant de la sélection).
// Pour poster un pari il faut EN PLUS `eventBetTypeId` (le marché) et surtout
// la cote FRAÎCHE : on relit donc l'événement complet au moment du pari.
// C'est à la fois la résolution des IDs et le garde-fou « cote fermée ».
// ═══════════════════════════════════════════════════════════════════

const EVENT_API = "https://hg-event-api-prod.sporty-tech.net/api/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
const HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "fr-FR,fr;q=0.9",
  "user-agent": UA,
  origin: "https://www.congobet.net",
  referer: "https://www.congobet.net/",
};

export interface CongobetSelection {
  eventId: number;
  eventBetTypeId: number;
  eventBetTypeItemId: number;
  odds: number;
  marketName: string;
  selectionName: string;
  /** Mise minimale et maximale imposées par ce marché Congobet */
  minStake?: number;
  maxStake?: number;
}

/**
 * Retrouve la sélection `itemId` dans l'événement `eventId` et renvoie sa cote
 * fraîche. Renvoie une erreur explicite si le marché est fermé/suspendu/retiré.
 */
export async function resolveCongobetSelection(eventId: number | string, itemId: number | string): Promise<
  | { ok: true; selection: CongobetSelection }
  | { ok: false; code: string; reason: string }
> {
  let json: Record<string, any> | null = null;
  try {
    const res = await fetch(`${EVENT_API}events/${eventId}`, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return { ok: false, code: "event_unreachable", reason: `Événement Congobet illisible (HTTP ${res.status})` };
    json = await res.json();
  } catch (e) {
    return { ok: false, code: "event_unreachable", reason: `Événement Congobet injoignable : ${String((e as Error)?.message || e)}` };
  }

  const betTypes = json?.eventBetTypes;
  if (!Array.isArray(betTypes) || !betTypes.length) {
    return { ok: false, code: "no_markets", reason: "Aucun marché ouvert sur ce match chez Congobet" };
  }

  for (const bt of betTypes) {
    for (const it of bt.eventBetTypeItems || []) {
      if (String(it.id) !== String(itemId)) continue;
      if (!it.active || !it.bettingAllowed) {
        return { ok: false, code: "market_closed", reason: "Sélection suspendue par Congobet (paris fermés)" };
      }
      // ⚠️ CAUSE RÉELLE DES PARIS À DÉCOUVERT : la sélection peut être
      // ouverte (`bettingAllowed: true`) alors que son MARCHÉ PARENT est
      // verrouillé (`bettingAllowed: false`). La cote reste lisible, mais
      // Congobet rejette le placement avec « BettingNotAllowed ».
      // On vérifie donc les deux niveaux avant d'engager quoi que ce soit.
      if (!bt.active || !bt.bettingAllowed) {
        return { ok: false, code: "market_closed", reason: `Marché « ${bt.name || ""} » verrouillé par Congobet (paris non autorisés) — aucune mise engagée` };
      }
      const odds = Number(it.odds);
      if (!(odds > 1)) return { ok: false, code: "market_closed", reason: "Cote Congobet retirée" };
      return {
        ok: true,
        selection: {
          eventId: Number(json.id ?? eventId),
          eventBetTypeId: Number(bt.id),
          eventBetTypeItemId: Number(it.id),
          odds,
          marketName: bt.name || "",
          selectionName: it.shortName || it.name || "",
          minStake: Number(bt.baseAmount) || undefined,
          maxStake: Number(bt.maximumAmount) || undefined,
        },
      };
    }
  }

  return { ok: false, code: "selection_gone", reason: "La sélection n'existe plus chez Congobet (marché retiré)" };
}