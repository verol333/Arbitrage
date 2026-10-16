// ═══════════════════════════════════════════════════════════════════
// YELLOWBET — RELAIS GRATUIT (remplace le lecteur Jina payant).
//
// CONSTAT MESURÉ LE 17/09/2026 : yellowbet.cg ne bloque pas le pays, il bloque
// L'ADRESSE de nos serveurs (page 403 renvoyée à toute requête, en-têtes
// parfaits inclus). Depuis n'importe quelle autre machine, la même requête
// répond 200. Il suffit donc d'un petit relais hébergé ailleurs — gratuit —
// pour parler au site : plus besoin de clé de lecteur à renouveler.
//
// Le relais rejoue une séquence de requêtes en gardant les cookies et le jeton
// de session, exactement comme le pont Jina : les deux sont interchangeables.
// Dépôt du relais : github.com/verol333/alve-yellowbet-relay
//
// Tant que YB_RELAY_URL n'est pas renseigné, tout continue de passer par Jina.
// ═══════════════════════════════════════════════════════════════════

export interface RelayResult { status: number; text: string }

export const relayConfigured = () => !!Deno.env.get("YB_RELAY_URL");

/**
 * Exécute la séquence via le relais.
 * Renvoie null si le relais n'est pas configuré ou ne répond pas — l'appelant
 * bascule alors sur l'ancien pont, aucune interruption de service.
 */
export async function relayRun(requests: unknown[]): Promise<RelayResult[] | null> {
  const url = Deno.env.get("YB_RELAY_URL");
  const secret = Deno.env.get("YB_RELAY_SECRET") || "";
  if (!url) return null;

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-relay-secret": secret },
    body: JSON.stringify({ requests }),
    signal: AbortSignal.timeout(45000),
  }).catch(() => null);
  if (!r || !r.ok) return null;

  const j = await r.json().catch(() => null);
  return Array.isArray(j?.results) ? j.results : null;
}