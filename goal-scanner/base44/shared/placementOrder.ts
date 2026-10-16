// ═══════════════════════════════════════════════════════════════════
// ORDRE DE POSE DES DEUX JAMBES — anti-position à découvert.
//
// CONSTAT MESURÉ le 19/08/2026 sur les 37 derniers placements réels :
//   • 18 placements ont laissé UNE SEULE jambe engagée (position à découvert) ;
//   • ZÉRO placement n'a vu ses deux jambes acceptées.
//
// Taux de REFUS réels par bookmaker (jambes réellement postées) :
//   betmomo   17 refus / 17 tentatives → 100 %
//   congobet   4 refus /  4            → 100 %
//   betpawa    2 refus /  2            → 100 %
//   1xbet     10 refus / 13            →  77 %
//   1win       5 refus / 20            →  25 %
//
// Le départ SIMULTANÉ des deux jambes était donc la cause mécanique des
// découverts : 1win accepte presque toujours, les autres refusent presque
// toujours, donc à chaque tentative 1win partait seul et restait nu.
//
// Règle retenue : on pose D'ABORD la jambe la plus fragile, et on ne pose la
// seconde QUE si la première est confirmée. Si la fragile refuse, RIEN n'est
// engagé — zéro exposition. Le seul découvert résiduel possible devient
// « fragile acceptée puis fiable refusée », le cas de très loin le plus rare.
// ═══════════════════════════════════════════════════════════════════

/** Risque de refus par bookmaker : plus le chiffre est haut, plus on pose tôt. */
export const REFUSAL_RISK: Record<string, number> = {
  betmomo: 100,
  congobet: 100,
  // ⚠️ INCIDENT DU 15/09/2026 — betPawa doit passer AVANT les autres « 100 ».
  // Deux positions à découvert sur le même match (Rakow - Zaglebie, Pair/Impair) :
  // congobet et betpawa étaient tous deux notés 100, l'égalité conservait
  // l'ordre du scanner et congobet est donc parti EN PREMIER. Il a confirmé,
  // puis betPawa a refusé (sélection hors ligne) → congobet engagé seul, deux
  // fois de suite. betPawa cumule les deux fragilités : refus « hors ligne » et
  // validation live différée. Il part donc toujours avant tout autre book.
  betpawa: 105,
  // 18/09/2026 : YellowBet n'a JAMAIS confirmé un pari réel (0 acceptée sur
  // 30 tentatives). Découvert du 18/09 à 01h12 : betPawa (105) est parti en
  // premier et a confirmé, YellowBet (95) a refusé (« status Suspended ») →
  // betPawa nu. Le book au taux de refus de 100 % passe devant tous les autres.
  yellowbet: 110,
  apollo: 85,
  "1xbet": 77,
  "1xbet_mobile": 77,
  "1win": 25,
};

/**
 * ⚠️ 18/09/2026 — LE CLASSEMENT LIVE NE VAUT RIEN EN PRÉ-MATCH.
 * Taux de refus RÉELS mesurés sur les 500 dernières jambes réellement postées,
 * séparés par type de match :
 *            live            pré-match
 *   betpawa   33 % (23/70)    0 %  (0/50)
 *   betmomo   —               29 % (2/7)
 *   1xbet     100 % (10/10)   6 %  (1/16)
 *   1win      12 % (6/49)     4 %  (3/68)
 * betPawa, classé le plus fragile (105) à cause de ses refus EN DIRECT, partait
 * donc en premier même en pré-match — où il n'a pas refusé une seule fois sur
 * 50 mises. Résultat mécanique : il confirmait, puis BetMomo (29 % de refus)
 * refusait derrière lui → betPawa nu. C'est exactement le découvert du 17/09
 * (2 × « MatchSuspended », 975 F). Le pré-match a donc son propre classement,
 * bâti sur ses propres chiffres.
 */
export const PREMATCH_REFUSAL_RISK: Record<string, number> = {
  betmomo: 29,
  congobet: 90,   // aucune mise pré-match mesurée → prudence
  yellowbet: 90,  // idem
  apollo: 85,     // idem
  "1xbet": 6,
  "1xbet_mobile": 6,
  "1win": 4,
  betpawa: 0,
};

/** Risque par défaut d'un book non encore mesuré : traité comme fragile. */
export const DEFAULT_RISK = 90;

export const riskOf = (book: string, isLive = true): number => {
  const b = String(book || "").toLowerCase();
  return isLive
    ? (REFUSAL_RISK[b] ?? DEFAULT_RISK)
    : (PREMATCH_REFUSAL_RISK[b] ?? DEFAULT_RISK);
};

/**
 * Trie les deux jambes : la plus susceptible d'être refusée passe en premier.
 * À risque égal, l'ordre d'origine est conservé (résultat stable).
 */
/**
 * Books dont la CONFIRMATION LIVE est différée par le bookmaker lui-même :
 * la mise n'est acquise qu'après un second appel, et ce second appel peut être
 * refusé (1xBet, betPawa, et YellowBet qui impose 8 s entre pré-validation et
 * confirmation). Un tel book doit TOUJOURS partir seul en premier en direct :
 * il est le seul dont le refus peut tomber après qu'une autre mise soit partie.
 */
export const DEFERRED_LIVE_CONFIRM = ["1xbet", "1xbet_mobile", "betpawa", "yellowbet"];

/** true = ce book doit passer en premier en direct, quoi qu'il arrive. */
export const mustGoFirstLive = (book: string, isLive: boolean): boolean =>
  isLive && DEFERRED_LIVE_CONFIRM.includes(String(book || "").toLowerCase());

export function orderLegs<T extends { book: string }>(legs: T[], isLive = false): T[] {
  // Incidents du 12/09 (1xBet) et du 17/09 (YellowBet) : un book à confirmation
  // différée doit précéder toute autre mise live. Pré-match inchangé.
  const rank = (book: string) =>
    mustGoFirstLive(book, isLive) ? 1000 + riskOf(book, isLive) : riskOf(book, isLive);
  return legs
    .map((leg, index) => ({ leg, index }))
    .sort((x, y) => rank(y.leg.book) - rank(x.leg.book) || x.index - y.index)
    .map((x) => x.leg);
}

/**
 * Refus AMBIGU : le bookmaker n'a pas dit non, il n'a simplement pas confirmé
 * (opération encore en cours, aucun numéro de ticket renvoyé, coupure réseau).
 * Le pari peut très bien être enregistré chez lui.
 *
 * Dans ce cas il est INTERDIT de reposer la mise : on risquerait de parier deux
 * fois du même côté. On arrête tout et on demande une vérification humaine.
 */
export function isAmbiguousRefusal(error: unknown): boolean {
  const t = String(error ?? "").toLowerCase();
  if (!t) return false;
  // Un refus CERTAIN est reconnaissable : le bookmaker dit précisément pourquoi
  // il n'a rien enregistré. Tout le reste est ambigu par défaut.
  return !isExplicitRefusal(t);
}

/**
 * Refus CERTAIN — le bookmaker énonce un motif qui exclut tout enregistrement :
 * pas assez d'argent, mise hors bornes, marché fermé, cote changée, sélection
 * disparue, session refusée, match déjà commencé.
 *
 * ⚠️ CETTE LISTE EST LA SEULE PORTE VERS UNE REPRISE DE MISE. Elle a été bâtie
 * sur les réponses RÉELLES relevées le 15/09/2026 en posant une mise de sonde
 * chez chaque bookmaker connecté (voir la fonction bookResponseProbe) :
 *   • 1win     succès → { result: { success: { betId } } }
 *   • Congobet succès → { betSystemsIds: [id], betLines: [...] }
 * Un message inconnu n'est JAMAIS présumé « refusé » : c'est précisément cette
 * présomption qui a fait reposer une mise déjà enregistrée par 1win (doublon du
 * 15/09/2026). Inconnu ⇒ ambigu ⇒ on gèle et on fait vérifier le ticket.
 */
export function isExplicitRefusal(error: unknown): boolean {
  const t = String(error ?? "").toLowerCase();
  if (!t) return false;
  return new RegExp([
    // Argent
    "fonds insuffisants", "not_?enough_?funds", "insufficient", "solde insuffisant", "balance",
    // Bornes de mise
    "minimum autoris", "maximum autoris", "min_?bet", "max_?bet", "mise maximum", "mise minimum",
    "sous le minimum", "au-dessus du maximum", "stake_?limit", "limit_?exceeded",
    // ── SÉLECTION REFUSÉE AVANT TOUT ENREGISTREMENT ──────────────────────
    // Ajouté après l'incident du 15/09/2026. betPawa refuse en
    // FOB_OFFLINE_PRICES (« sélection hors ligne — le bookmaker refuse de la
    // jouer ») : c'est son VALIDATEUR qui rejette, avant la moindre écriture de
    // ticket — rien n'est engagé, le solde ne bouge pas. Ce motif ne figurait
    // pas ici : il était donc classé « ambigu », donc AUCUNE couverture n'était
    // tentée et l'utilisateur recevait « vérifiez à la main » alors que l'autre
    // jambe était nue. Deux positions à découvert dans la même minute.
    "hors ligne", "offline_?prices", "refuse de la jouer", "non jouable",
    // 1win refuse la sélection AVANT tout enregistrement en renvoyant
    // « selections_errors » (constaté le 17/09/2026, Paraguay U19 - Argentina U19,
    // solde inchangé après refus) : refus certain, rien n'est engagé chez lui.
    "selections?_?errors?",
    // Le détail par sélection de « selections_errors » : 1win FERME la cote une
    // poignée de secondes (odd_closed) tout en la publiant encore. Son
    // validateur rejette avant toute écriture — solde inchangé, vérifié le
    // 17/09/2026. Sans ce motif ici, la couverture était classée « ambiguë » et
    // abandonnée dès la première reprise, jambe adverse nue.
    "odd_?closed", "odd_?blocked", "cote vient d'[eê]tre ferm", "cote ferm[eé]e",
    // YellowBet, refus métier de son validateur (constatés le 17/09/2026, solde
    // inchangé) : confirmation envoyée avant la fin du délai live imposé
    // (« Live time delay not met ») et issue plus proposée sur le match
    // (« Bet type odd was not found in event data », BadOdds). Classés
    // « ambigus » faute de figurer ici, ils bloquaient la couverture immédiate
    // ET le rattrapage après coup : 1win restait seul engagé, sans alerte.
    "live time delay", "not found in event data", "bad_?odds",
    "rien n'est engag", "aucune mise \\S+ enregistr",
    "refus[eé] le pari apr[eè]s validation", "concurrent_?bet_?placement",
    "un pari [aà] la fois", "cote plancher", "s[eé]lection mobile indisponible",
    // Marché / cote / sélection
    "march[eé] (?:ferm|suspendu|indisponible)", "market_?(?:closed|suspended|unavailable)",
    // BetMomo refuse en « MatchSuspended » (result 2036) — constaté le
    // 17/09/2026 sur Batumi - CSM Oradea : son validateur bloque le match avant
    // toute écriture, rien n'est engagé. Ce libellé collé (sans espace) ne
    // correspondait à aucun motif ci-dessus : le refus passait pour « ambigu »,
    // donc la jambe betPawa partait en couverture et restait nue (425 F).
    "match_?suspended", "event_?suspended", "suspended",
    "odds?_?changed", "coefficient", "cote a chang", "price_?changed", "cote indisponible",
    "s[eé]lection (?:introuvable|indisponible|retir)", "selection_?(?:not_?found|unavailable|removed)",
    "event_?(?:started|finished|closed)", "match (?:d[eé]j[aà] commenc|termin)", "blocked_?event",
    // Session / droits
    // 1xBet 401 à la pose (jeton expiré entre la lecture du solde et la mise) :
    // rien n'est enregistré côté bookmaker. Classé « ambigu » jusqu'au
    // 15/09/2026, il laissait la jambe adverse nue (betPawa 19 500 F).
    "authentification refus", "\\(401\\)", "auth_?expired",
    "unauthorized", "forbidden", "session expir", "token_?expired", "bad_?credentials",
    "identifiants", "compte (?:bloqu|suspendu)", "account_?(?:blocked|suspended)",
  ].join("|")).test(t);
}