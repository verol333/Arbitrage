// ═══════════════════════════════════════════════════════════════════
// APOLLO — résolution d'une sélection réelle (BetData / Pick) à partir de
// l'ID de match fourni par le scanner, de la famille de marché et du libellé.
//
// Endpoint découvert via la configuration client Apollo :
//   GET {SportApiUrl}offer/v3/match/offers?matchId=<id>
//   SportApiUrl = https://sportapis-apollo.webapis.sk/SportsOfferApi/api/sport/
// Réponse : { Id, LeagueId, IsBlocked, Offers:[ { Description, Sbv, GameId, Active,
//              Odds:[ { Id (=BetData), Name, PickCode (=Pick), Odd, Active, UofKey } ] } ] }
// ═══════════════════════════════════════════════════════════════════

const OFFER_API = "https://sportapis-apollo.webapis.sk/SportsOfferApi/api/sport/offer/v3";

const HEADERS: Record<string, string> = {
  accept: "application/json",
  origin: "https://m.apollogames.cg",
  referer: "https://m.apollogames.cg/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  "Device-Type": "mobile",
  "TerminalId": "33",
  "LanguageId": "fr",
};

export interface ApolloSelection {
  betData: number;      // Odds[].Id
  pick: string;         // PickCode
  odd: number;          // cote fraîche lue à l'instant
  eventId: number;
  leagueId: number;
  gameId: number;
  sbv: string | null;
  pickIdentifier?: string;
  probability?: number;
  market: string;       // Description Apollo du marché retenu
  label: string;        // libellé Apollo de la sélection retenue
}

/** Réduit une chaîne à une clé comparable (sans accents, minuscules, alphanum). */
function norm(s: string): string {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+./:-]/g, "");
}

/** Extrait la ligne numérique d'un libellé (« Total 2.5 » → 2.5). */
function lineOf(s: string): number | null {
  const m = String(s).replace(",", ".").match(/-?\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(",", ".")) : null;
}

// Familles de marché du scanner (FR/EN) → motif attendu dans la Description Apollo.
// ⚠️ Les libellés de marché Apollo ont changé (constaté le 19/08/2026) : la
// Description ne vaut plus « Basic offer » ou « Total goals » seuls, mais
// « 1x2 », « Total goals [1.5] », « Double chance (1X - 12 - X2) »,
// « {$competitor1} clean sheet »… Les motifs ancrés ne trouvaient donc plus
// aucun marché : la jambe Apollo était systématiquement déclarée indisponible.
// ⚠️ Apollo renvoie ses libellés DANS LA LANGUE demandée (LanguageId=fr côté
// serveur) : « Offre de base », « Nombre de buts [1.5] »… Reconnaître un marché
// par son libellé est donc impossible depuis le serveur. On s'appuie sur
// BetTypeKey, identifiant technique stable et indépendant de la langue ; les
// motifs de libellés ne servent plus que de filet de secours.
const FAMILY_KEYS: Array<[RegExp, string[]]> = [
  [/clean\s*sheet.*(ext|away)/i, ["8_1729"]],
  [/clean\s*sheet.*(dom|home)/i, ["8_1728"]],
  [/(btts|both teams|les deux equipes)/i, ["8_30"]],
  [/double\s*chance/i, ["8_27"]],
  [/draw\s*no\s*bet|remboursé si nul/i, ["7_16"]],
  [/^(1x2|match|resultat|résultat)/i, ["2_-1"]],
  [/corner.*(equipe 1|team 1|domicile|home)/i, ["8_132"]],
  [/corner.*(equipe 2|team 2|exterieur|away)/i, ["8_133"]],
  [/corner.*(pair|impair|odd|even)/i, ["8_138"]],
  [/corner/i, ["8_126"]],
  [/(carton|booking)/i, ["8_153"]],
  [/(total|over|under|plus de|moins de).*(equipe 1|team 1|domicile|home)/i, ["8_142"]],
  [/(total|over|under|plus de|moins de).*(equipe 2|team 2|exterieur|away)/i, ["8_143"]],
  [/handicap\s*asiatique|asian\s*handicap/i, ["7_34"]],
  [/(pair|impair|odd.*even)/i, ["8_31"]],
  [/(total|over|under|plus de|moins de)/i, ["5_-1"]],
];

const FAMILY_PATTERNS: Array<[RegExp, RegExp]> = [
  [/clean\s*sheet.*(ext|away)/i, /(competitor2|away).*clean sheet|clean sheet.*(competitor2|away)/i],
  [/clean\s*sheet.*(dom|home)/i, /(competitor1|home).*clean sheet|clean sheet.*(competitor1|home)/i],
  [/(btts|both teams|les deux equipes)/i, /both teams to score/i],
  [/double\s*chance/i, /double chance/i],
  [/draw\s*no\s*bet|remboursé si nul/i, /draw no bet/i],
  [/^(1x2|match|resultat|résultat)/i, /^1x2/i],
  [/(total|over|under|plus de|moins de).*(equipe 1|team 1|domicile|home)/i, /total\s*hometeam/i],
  [/(total|over|under|plus de|moins de).*(equipe 2|team 2|exterieur|away)/i, /total\s*awayteam/i],
  [/mi-?temps 1|1st half|1ere mi/i, /1(st|ere|ère).*half/i],
  [/mi-?temps 2|2nd half|2eme mi/i, /2(nd|eme|ème).*half/i],
  [/(pair|impair|odd.*even)/i, /odd\s*\/\s*even/i],
  [/(total|over|under|plus de|moins de)/i, /total goals/i],
];

// Libellé de sélection du scanner → noms possibles côté Apollo.
// Apollo abrège aussi les sélections : « u » / « o » pour under/over,
// « goal » / « nogoal » pour BTTS, « x » en minuscule pour le nul.
const LABEL_ALIASES: Array<[RegExp, string[]]> = [
  [/^(oui|yes|gg)$/i, ["yes", "gg", "oui", "goal"]],
  [/^(non|no|ng)$/i, ["no", "ng", "non", "nogoal"]],
  // ⚠️ Le tiret de « Au-Dessus De 2.5 » était pris pour un signe moins : la
  // sélection « under » était renvoyée pour un pari « over » (pari inverse).
  // Le signe ne compte que s'il précède réellement un nombre.
  [/(over|plus de|dessus|\+\s*\d)/i, ["over", "o", "+"]],
  [/(under|moins de|dessous|-\s*\d)/i, ["under", "u", "-"]],
  [/^(1x)$/i, ["1x"]],
  [/^(x2)$/i, ["x2"]],
  [/^(12)$/i, ["12"]],
  [/^(1|domicile|home)$/i, ["1"]],
  [/^(x|nul|draw)$/i, ["x"]],
  [/^(2|exterieur|extérieur|away)$/i, ["2"]],
  // ⚠️ PARI INVERSE POSÉ (audit du 15/09/2026, marché « Nombre de buts
  // impair/paire ») : « Impair » CONTIENT « pair », et le motif « pair » était
  // testé en premier → la sélection « Pair » était renvoyée pour un pari
  // « Impair ». L'impair est donc reconnu D'ABORD, et « pair » est ancré.
  [/(impair|impaire|\bodd\b)/i, ["odd", "impair"]],
  [/(^|\W)(pair|paire|even)(\W|$)/i, ["even", "pair"]],
];

function labelCandidates(label: string): string[] {
  // Le scanner suffixe parfois la sélection par sa famille (« Extérieur (DNB) »,
  // « Oui (BTTS) ») : on retire les parenthèses avant de reconnaître le libellé.
  const clean = String(label).replace(/\([^)]*\)/g, " ").trim();
  for (const [re, names] of LABEL_ALIASES) {
    if (re.test(clean)) return names.map(norm);
  }
  return [norm(clean)];
}

/** Lit l'offre complète d'un match Apollo (null si indisponible). */
export async function fetchApolloMatch(matchId: number | string) {
  const res = await fetch(`${OFFER_API}/match/offers?matchId=${matchId}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  return await res.json().catch(() => null);
}

/** Sélectionne les offres Apollo compatibles avec la famille de marché demandée. */
function matchingOffers(offers: any[], family: string, line: number | null): any[] {
  let keys: string[] | null = null;
  for (const [famRe, k] of FAMILY_KEYS) {
    if (famRe.test(family)) { keys = k; break; }
  }
  let pattern: RegExp | null = null;
  for (const [famRe, descRe] of FAMILY_PATTERNS) {
    if (famRe.test(family)) { pattern = descRe; break; }
  }
  const active = offers.filter((o) => o.Active !== false && Array.isArray(o.Odds) && o.Odds.length);
  let byFamily = keys ? active.filter((o) => keys!.includes(String(o.BetTypeKey || ""))) : [];
  // Filet de secours si l'identifiant technique change : reconnaissance par libellé.
  if (!byFamily.length && pattern) byFamily = active.filter((o) => pattern!.test(String(o.Description || "")));
  // Aucune famille reconnue → on refuse plutôt que de risquer un mauvais marché.
  if (!keys && !pattern) return [];
  // On ne filtre par Sbv QUE pour les marchés à ligne (Total/Over/Under/Handicap).
  // Pour 1X2, Double Chance, BTTS, etc. : pas de ligne, et lineOf() peut extraire
  // un faux positif (ex: « 1 » dans « 1X2 ») qui élimine toutes les offres valides.
  const isLineFamily = /(total|over|under|handicap|plus de|moins de)/i.test(family);
  if (line === null || !isLineFamily) return byFamily;
  // Famille avec ligne (total/handicap) : la Sbv doit correspondre exactement.
  return byFamily.filter((o) => o.Sbv !== null && o.Sbv !== undefined && Number(o.Sbv) === line);
}

/**
 * Résout une sélection Apollo réelle.
 * @param matchId  apollo_match_id fourni par le scanner
 * @param family   market_family (ex: "Clean Sheet Extérieur", "Total 2.5")
 * @param legLabel libellé de la jambe (ex: "Oui", "Over 2.5", "X2")
 * Renvoie null si le match est bloqué ou si le marché/la sélection est absent ou suspendu.
 */
export async function resolveApolloSelection(
  matchId: number | string,
  family: string,
  legLabel: string,
): Promise<ApolloSelection | null> {
  const match = await fetchApolloMatch(matchId);
  if (!match || match.IsBlocked) return null;

  const line = lineOf(family) ?? lineOf(legLabel);
  const wanted = labelCandidates(legLabel);
  const offers = matchingOffers(Array.isArray(match.Offers) ? match.Offers : [], family, line);

  for (const offer of offers) {
    for (const odd of offer.Odds) {
      if (odd.Active === false) continue;
      const names = [odd.PickCode, odd.Name, odd.ExtendedName, odd.OrigName, odd.Type]
        .filter(Boolean)
        .map((x: string) => norm(String(x)));
      if (!wanted.some((w) => names.includes(w))) continue;

      // ⚠️ CAUSE RACINE DES PARIS APOLLO JAMAIS PRIS (prouvé le 12/09/2026).
      // Apollo renvoie TOUJOURS « Id: 0 » dans ses Odds : l'identifiant réel
      // attendu par /submit dans BetData est celui de l'OFFRE (offer.Id, ex.
      // 468152879 — même ordre de grandeur que la capture F12 d'origine).
      // Nous envoyions donc BetData: 0, et Apollo répondait invariablement
      // « Offre rétirée du serveur » (Error 10) sans jamais créer de ticket.
      // Second défaut du même appel : PickCode vaut souvent la chaîne VIDE, et
      // `??` ne bascule que sur null/undefined → Pick partait vide.
      const pick = [odd.PickCode, odd.Type, odd.Name]
        .map((v: unknown) => (v === null || v === undefined ? "" : String(v).trim()))
        .find((v: string) => v !== "") || "";
      return {
        betData: Number(offer.Id ?? odd.Id ?? 0),
        pick,
        odd: Number(odd.Odd),
        eventId: Number(match.Id),
        leagueId: Number(match.LeagueId ?? 0),
        gameId: Number(offer.GameId ?? 1),
        sbv: offer.Sbv === null || offer.Sbv === undefined ? null : String(offer.Sbv),
        pickIdentifier: odd.UofKey || undefined,
        probability: typeof odd.Probability === "number" ? odd.Probability : undefined,
        market: String(offer.Description || ""),
        label: String(odd.ExtendedName || odd.Name),
      };
    }
  }
  return null;
}