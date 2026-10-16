// ═══════════════════════════════════════════════════════════════════
// RÉPARATION IMMÉDIATE DU JETON 1xBet PENDANT UNE TENTATIVE DE PARI.
//
// LE PROBLÈME MESURÉ (07/09/2026) : sur la paire 1xBet+1win — celle qui porte
// les vraies marges — 34 tentatives sur 250 mouraient à l'étape « connexion »
// avec « 1xBet mobile : Solde non disponible ». 1win était pourtant connecté et
// approvisionné : l'opportunité était perdue pour un jeton d'accès périmé.
//
// Le jeton d'accès 1xBet ne vit que ~20 min ; le refresh token, lui, vit des
// mois. Le jeton est bien régénéré avant la tentative quand l'horloge le dit
// périmé — mais 1xBet le refuse AUSSI hors calendrier (rotation manquée,
// renouvellement concurrent). Dans ce cas il n'y avait aucun recours : on
// abandonnait l'opportunité.
//
// Les adaptateurs bookmaker sont volontairement sans état et ne connaissent ni
// la base ni les sessions. On leur laisse donc ici une porte de secours : la
// fonction qui sait régénérer le jeton est déposée avant la tentative, et
// l'adaptateur peut l'appeler UNE fois si 1xBet refuse le jeton.
// ═══════════════════════════════════════════════════════════════════

type Renew = () => Promise<string | null>;

/** Une seule entrée par jeton — remplacée à chaque tentative. */
const hooks = new Map<string, Renew>();

/** Limite de sécurité : la table ne doit jamais enfler en mémoire. */
const MAX = 20;

export function registerXbetRenew(token: string, fn: Renew): void {
  if (!token) return;
  if (hooks.size >= MAX) hooks.clear();
  hooks.set(token, fn);
}

/**
 * Régénère le jeton lié à `token`. Renvoie le jeton frais, ou null si aucune
 * réparation n'est possible (pas de refresh token, ou 1xBet refuse aussi).
 */
export async function renewXbetFor(token: string): Promise<string | null> {
  const fn = token ? hooks.get(token) : null;
  if (!fn) return null;
  // Une porte de secours ne sert qu'une fois : si le jeton frais est refusé à
  // son tour, c'est un vrai problème de compte, pas une péremption.
  hooks.delete(token);
  const fresh = await fn().catch(() => null);
  return fresh && fresh !== token ? fresh : null;
}

/** Vide la table (tests et simulations). */
export function resetXbetRenewHooks(): void {
  hooks.clear();
}