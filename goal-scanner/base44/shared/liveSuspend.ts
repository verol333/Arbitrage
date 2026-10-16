// ═══════════════════════════════════════════════════════════════════
// INTERRUPTEUR GLOBAL — SUSPENSION DES PARIS AUTOMATIQUES SUR LES LIVES.
//
// Les paris live sont la cause principale des positions à découvert :
// cotes suspendues en pleine pose, validations différées, re-tarification.
// Tant que ce drapeau est à `true`, AUCUNE mise automatique n'est engagée
// sur un match en cours, pour TOUS les comptes. Les opportunités live
// restent visibles à l'écran ; seul le placement automatique est bloqué.
// Le rattrapage des positions déjà ouvertes n'est PAS concerné : couvrir
// une jambe existante protège l'argent, ce blocage ne s'y applique pas.
//
// Pour réactiver les lives : passer ce drapeau à `false`.
// ═══════════════════════════════════════════════════════════════════

// 28/08/2026 — RÉACTIVÉ. Mesures à l'appui : sur 8 opportunités live relues
// 41 s après capture, l'écart de cote réel était de 0 % (1xBet, 1win), +2,7 %
// (betPawa), −3,1 % (Congobet), +5 % (Apollo). Et sur 400 tentatives live, un
// SEUL pari à découvert : la pose « jambe fragile d'abord » a réglé la cause.
// Trois garde-fous accompagnent cette réouverture (voir autoWatchUser.ts) :
// âge maximum de l'opportunité, exclusion des comptes sans solde avant toute
// tentative, et aucune attente sur un marché verrouillé en live.
export const LIVE_AUTO_SUSPENDED = false;

// ── 22/09/2026 — LIVES RÉOUVERTS À TOUS LES COMPTES ─────────────────
// Mesuré sur les 1 000 dernières tentatives (18 → 22/09) : SEPT positions à
// découvert seulement, toutes de la même forme — la seconde jambe refusée à la
// seconde près. Et toutes impliquaient YellowBet ou 1xBet, désormais écartés du
// direct (voir LIVE_EXCLUDED_BOOKS). Sur 1win + betPawa, aucun découvert n'est
// resté non couvert. Le direct est donc rendu à tous les comptes, sans plafond
// de mise particulier : ces deux bookmakers répondent proprement.
// ── 16/09/2026 — LIVES RÉSERVÉS À L'ADMINISTRATEUR ──────────────────
// Le live est remis en chantier : les cotes fraîches relues au moment de la
// pose contredisaient trop souvent la marge annoncée par le scanner
// (« plus d'arbitrage sur les cotes fraîches »). Le temps de comprendre et de
// corriger, PLUS AUCUN compte utilisateur ne prend de pari en direct — seul
// le compte administrateur continue, pour pouvoir mesurer en conditions
// réelles. Les pré-match ne sont pas concernés et tournent normalement.
// Pour rouvrir les lives à tout le monde : repasser ce drapeau à `false`.
export const LIVE_ADMIN_ONLY = false;

/** Le live est-il bloqué pour ce rôle de compte ? */
export function isLiveBlocked(role: unknown): boolean {
  if (LIVE_AUTO_SUSPENDED) return true;
  return LIVE_ADMIN_ONLY && String(role || "") !== "admin";
}

// ── 18/09/2026 — YELLOWBET RETIRÉ DE LA MISE AUTOMATIQUE RÉELLE ────────
// Mesuré sur l'intégralité de l'historique : ZÉRO pari réel jamais confirmé
// par YellowBet (30 tentatives sur les 36 dernières heures, 0 acceptée :
// « status Suspended », « Live time delay not met », « odd was not found »).
// Chaque opportunité YellowBet est donc une pièce truquée : soit rien ne
// part, soit l'autre book part et reste nu (découverts du 17/09 et du 18/09,
// 01h12). Tant qu'un ticket YellowBet réel n'a pas été confirmé de bout en
// bout, aucune mise automatique ne le concerne. Les simulations (dry-run) et
// les codes coupon YellowBet restent disponibles.
// 18/09/2026, 10h35 — YELLOWBET REMIS EN SERVICE. Deux paris réels ont été
// confirmés de bout en bout à la main, et la sonde live montre 0 % d'écart
// entre les cotes annoncées et les cotes relues (38 marchés comparés). La
// condition posée ci-dessus (« tant qu'un ticket réel n'a pas été confirmé »)
// est donc remplie : plus aucun book n'est retiré de la mise automatique.
export const AUTO_SUSPENDED_BOOKS: string[] = [];
export const bookSuspendedMessage = (book: string) =>
  `${book} est retiré de la mise automatique : aucun pari réel n'y a jamais été confirmé — les opportunités qui le concernent restent visibles pour une pose manuelle`;

// ── 22/09/2026 — BOOKS ÉCARTÉS DE LA MISE AUTOMATIQUE EN DIRECT ─────────
// Ils restent pleinement actifs en PRÉ-MATCH ; seul le direct leur est fermé.
//
// YellowBet — 245 tentatives live sur 4 jours, UNE seule mise acceptée. Ses
// refus arrivent après un second appel différé de 8 s (« Live time delay not
// met », « status Suspended », « match introuvable dans le flux ») : quand il
// part en premier il bloque le cycle, et quand il confirme c'est l'autre jambe
// qui refuse derrière → 3 des 7 découverts de la période.
//
// 1xBet — zéro tentative live aboutie : son flux en direct est traduit en
// français (noms d'équipes différents du scanner) et son jeton de session
// périme en pleine pose. Il annule proprement avant toute mise, mais il ne
// produit aucun pari live utile. À réévaluer une fois l'appariement et le
// renouvellement de jeton éprouvés en pré-match.
export const LIVE_EXCLUDED_BOOKS = ["yellowbet", "1xbet", "1xbet_mobile"];

/** Ce bookmaker est-il écarté de la mise automatique sur les matchs en cours ? */
export const isBookLiveExcluded = (book: unknown, isLive: unknown): boolean =>
  !!isLive && LIVE_EXCLUDED_BOOKS.includes(String(book || "").toLowerCase());

export const bookLiveExcludedMessage = (book: string) =>
  `${book} ne prend plus de pari automatique EN DIRECT (ses refus tombent à la seconde et laissaient l'autre jambe à découvert) — ses paris pré-match continuent normalement, et l'opportunité reste visible pour une pose manuelle`;

export const LIVE_SUSPENDED_MESSAGE =
  "La prise de paris automatique sur les LIVES est temporairement suspendue — mise à jour en cours. Les paris pré-match continuent normalement.";