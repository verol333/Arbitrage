// ═══════════════════════════════════════════════════════════════════
// Correspondance entre les familles de marchés de notre scanner (en français)
// et les groupes de cotes réellement servis par 1win.
//
// ⚠️ LEÇON APPRISE : 1win sert ses noms de groupes tantôt en français
// (« Résultat du temps réglementaire »), tantôt en ANGLAIS
// (« Full time result ») selon la langue de la session. Une reconnaissance
// mono-langue faisait échouer TOUTES les mises sur ces marchés.
// → Ici tout est reconnu par MOTS-CLÉS bilingues, jamais par nom exact.
//
// Point de vigilance conservé : « Total » (buts) et « Total. Cartons jaunes »
// sont deux marchés DIFFÉRENTS → les marchés annexes sont exclus.
// Et une famille restreinte à une période ne peut être jouée que sur un
// groupe portant LA MÊME période (jamais sur le match entier).
// ═══════════════════════════════════════════════════════════════════

import { sameTeam } from "./teamMatch.ts";

export const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    // Les libellés de nos scanners utilisent le vrai signe « moins » (−) et le
    // tiret demi-cadratin : sans cette conversion, « −20.5 » était lu « 20.5 »
    // (côté inversé) ou pas lu du tout.
    .replace(/[\u2212\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ").trim();

/** Marchés annexes (statistiques) — jamais confondus avec les marchés de buts. */
const SIDE_MARKETS = [
  "carton", "card", "booking", "corner", "faute", "foul", "tir", "shot",
  "yellow", "jaune", "kart", "penalt", "hors-jeu", "offside", "throw", "remise en jeu",
  // ⚠️ Marchés ASIATIQUES : lignes à remboursement, règlement DIFFÉRENT du
  // total/handicap classique de nos scanners. Les confondre = pari faux.
  "asian", "asiatique",
];

export const isSideMarket = (groupName: string) => {
  const n = norm(groupName);
  return SIDE_MARKETS.some((k) => n.includes(k));
};

/**
 * UNITÉ COMPTÉE PAR LA FAMILLE : buts (par défaut), corners, cartons, fautes, tirs.
 *
 * ⚠️ CAUSE MESURÉE LE 22/09/2026 (23 opportunités perdues sur 400 tentatives) :
 * la famille « Corners Total 8.5 » tombait dans le type « total », donc le moteur
 * ouvrait le groupe « Total » de 1win — le total de BUTS — pendant que le vrai
 * marché, « Total. Corners », était écarté comme « marché annexe ». D'où le refus
 * « sélection “Plus de 8.5” non identifiable, candidats vus : Au-Dessus De 2.5 » :
 * on cherchait une ligne de corners dans les buts. Pire, sur une ligne commune
 * aux deux (« Corners Total 2.5 »), la sélection de BUTS aurait pu être retenue
 * et un pari faux posé. L'unité demandée doit donc être portée par le groupe.
 */
const UNITS: Array<[string, RegExp]> = [
  ["corner", /\bcorner(s)?\b/],
  ["carton", /\b(carton(s)?|card(s)?|jaune(s)?|booking(s)?)\b/],
  ["faute", /\b(faute(s)?|foul(s)?)\b/],
  ["tir", /\b(tir(s)?|shot(s)?)\b/],
];

/** Unité comptée par une famille du scanner. null = buts (marché principal). */
export function unitOf(family: string): string | null {
  const f = norm(family);
  for (const [u, rx] of UNITS) if (rx.test(f)) return u;
  return null;
}

/** Le groupe 1win compte-t-il bien la même chose que la famille demandée ? */
export function groupHasUnit(groupName: string, unit: string | null): boolean {
  const n = norm(groupName);
  if (unit === null) return !isSideMarket(n);
  const rx = UNITS.find(([u]) => u === unit)?.[1];
  if (!rx || !rx.test(n)) return false;
  // Une seule unité à la fois, et jamais une ligne asiatique (règlement différent).
  return !UNITS.some(([u, r]) => u !== unit && r.test(n)) && !/asian|asiatique/.test(n);
}

/* ───────────────────────── Périodes ───────────────────────── */

/**
 * Période visée par une famille de notre scanner.
 * Renvoie null pour un marché « match entier ».
 * Ex : « 1MT 1X2 » → half1 · « Q2 Handicap » → q2 · « Total Jeux 1er Set » → set1
 */
export type Period = "half1" | "half2" | "q1" | "q2" | "q3" | "q4" | "set1" | "set2" | "set3" | "set4" | "set5" | "games";

export function periodOf(family: string): Period | null {
  const f = norm(family);
  if (/\b(1mt|mt1)\b/.test(f) || /(1ere|1er|premiere) (mi-temps|mi temps|periode|half)/.test(f) || /\b1st half\b/.test(f)) return "half1";
  if (/\b(2mt|mt2)\b/.test(f) || /(2eme|2e|seconde|deuxieme) (mi-temps|mi temps|periode|half)/.test(f) || /\b2nd half\b/.test(f)) return "half2";
  const q = f.match(/\b(?:q|quart-temps|quart temps|quarter)\s*([1-4])\b/);
  if (q) return `q${q[1]}` as Period;
  const s = f.match(/\b(?:set|manche)\s*([1-5])\b/) || f.match(/\b([1-5])(?:er|eme|e|st|nd|rd|th)?\s*set\b/);
  if (s) return `set${s[1]}` as Period;
  if (/\b(jeux|games|game)\b/.test(f)) return "games";
  return null;
}

/** Le groupe 1win porte-t-il bien la période demandée ? (FR et EN) */
function groupHasPeriod(groupName: string, period: Period): boolean {
  const n = norm(groupName);
  switch (period) {
    case "half1":
      return /(1ere|1er|premiere) (mi-temps|mi temps|periode)/.test(n) || /\b(1st half|first half|1 mi-temps|mi-temps 1|ht1)\b/.test(n) || /^1(ere)?\s*mt\b/.test(n);
    case "half2":
      return /(2eme|2e|seconde|deuxieme) (mi-temps|mi temps|periode)/.test(n) || /\b(2nd half|second half|2 mi-temps|mi-temps 2|ht2)\b/.test(n);
    case "games":
      // Marché « jeux » (tennis / tennis de table) sur le match entier.
      return /\b(jeux|games)\b/.test(n) && !/\bset\b/.test(n);
    default: {
      const m = period.match(/^([qs])(?:et)?(\d)$/) || period.match(/^(q|set)(\d)$/);
      const num = period.slice(-1);
      if (period.startsWith("q")) {
        return new RegExp(`\\b(q${num}|quart-temps ${num}|quart temps ${num}|quarter ${num}|${num}(er|eme|e|st|nd|rd|th)? quart)\\b`).test(n);
      }
      return new RegExp(`\\b(set ${num}|manche ${num}|${num}(er|eme|e|st|nd|rd|th)? set)\\b`).test(n) || Boolean(m && false);
    }
  }
}

/** Le groupe est-il restreint à une période quelconque ? */
// ⚠️ « period » (anglais) manquait : un groupe « 1st period. Total » passait
// pour un marché match entier — risque de pari sur la mauvaise période.
const ANY_PERIOD = /(mi-temps|mi temps|periode|period|1st half|2nd half|half|\bset\b|manche|quart|quarter|\bq[1-4]\b|inning|\bht[12]\b)/;
const isPeriodGroup = (groupName: string) => ANY_PERIOD.test(norm(groupName));

/* ───────────────────── Familles de marchés ───────────────────── */

/** Mots-clés bilingues par type de marché. */
const KW = {
  // ⚠️ CAUSE RÉELLE MESURÉE LE 15/09/2026 : les surebets « Pair / Impair »
  // (famille « Pair/Impair », « Pair/Impair Jeux ») étaient cherchés dans le
  // groupe « Résultat du temps réglementaire » — le seul type reconnu par
  // défaut. 1win servait pourtant bien le marché : refus « sélection “Pair”
  // non identifiable, camp attendu ? » et opportunité perdue à chaque fois.
  oddEven: ["pair/impair", "impair", "impaire", "pair ou impair", "odd/even", "even/odd", "odd or even", "odd even"],
  doubleChance: ["double chance", "chance double"],
  btts: ["deux equipes vont marquer", "les deux equipes marquent", "both teams to score", "btts"],
  total: ["total", "totals", "plus/moins", "over/under"],
  handicap: ["handicap", "spread"],
  result: [
    "resultat du temps reglementaire", "resultat du match", "resultat", "1x2",
    "match result", "full time result", "fulltime result", "result",
    "vainqueur", "gagnant", "winner", "moneyline",
    // Basket / volley / hockey chez 1win : le vainqueur s'appelle « Equipe gagne »
    // (mesuré le 15/09/2026 : « Vainqueur du Match » déclaré absent alors que le
    // groupe était ouvert, 17 marchés listés).
    "equipe gagne", "team wins", "team to win",
  ],
};

const hasKw = (n: string, list: string[]) => list.some((k) => n.includes(k));

/* ⚠️ INCIDENT CIBALIA (perte réelle) : la famille « Draw No Bet » tombait dans
   le type générique « result » et le moteur jouait « Résultat du temps
   réglementaire » (victoire directe, cote 4.49) à la place du DNB (2.27). Le DNB
   est une famille à part : on ne joue QUE le groupe DNB de 1win ou, à défaut,
   le « Handicap » à la ligne 0 exactement (strictement équivalent). */
const DNB_KW = ["draw no bet", "sans match nul", "sans nul", "rembourse si", "pari sans nul", "dnb"];
export const isDnbFamily = (family: string) => hasKw(norm(family), DNB_KW) || /\bdnb\b/.test(norm(family));
export const isHandicapGroup = (groupName: string) => hasKw(norm(groupName), KW.handicap);

/**
 * Total d'une SEULE équipe (« Total Dom. 0.5 ») — chez 1win ces marchés portent
 * le nom de l'équipe (« Olympique de Marseille total ») et ne doivent jamais
 * être confondus avec le total de buts du match.
 */
export function teamTotalSide(family: string): "home" | "away" | null {
  const f = norm(family);
  if (!/\btotal/.test(f)) return null;
  // Abréviations réellement utilisées par nos scanners : J1/J2, T1/T2, E1/E2.
  if (/\b(dom|domicile|home|equipe 1|team 1|joueur 1|j1|t1|e1|p1)\b/.test(f)) return "home";
  if (/\b(ext|exterieur|away|equipe 2|team 2|joueur 2|j2|t2|e2|p2)\b/.test(f)) return "away";
  return null;
}

/** Conservé pour compatibilité : la famille cible-t-elle une période ? */
export const isPeriodFamily = (family: string) => periodOf(family) !== null;

/**
 * Libellé désignant une DOUBLE CHANCE (« 1X », « Domicile ou Nul »…).
 *
 * ⚠️ CAUSE N°1 DES MISES NON DÉCLENCHÉES (mesurée le 05/09/2026 sur les
 * journaux réels) : nos scanners produisent des paires CROISÉES, dont la
 * famille porte les DEUX marchés à la fois — « 1X2 — 2 + 1X ». La jambe « 2 »
 * vit dans le groupe « Résultat du temps réglementaire », mais la jambe « 1X »
 * vit dans le groupe « Double chance ». Le marché était choisi d'après la
 * FAMILLE seule : les deux jambes étaient donc cherchées dans le 1X2, et la
 * jambe double chance était déclarée « non identifiable » (« candidats vus :
 * Match Nul, Sk Artis Brno… »). C'est le libellé de LA JAMBE qui tranche.
 */
const DC_LABEL = /^(1x|x2|12|domicileounul|nuloudomicile|1ounul|nulou1|homeordraw|draworhome|nulouexterieur|exterieurounul|2ounul|nulou2|draworaway|awayordraw|domicileouexterieur|exterieuroudomicile|homeoraway|awayorhome|1ou2|2ou1|pasdenul|nonul|nodraw)$/;

/**
 * Code de double chance porté par un libellé : « 1x », « x2 » ou « 12 ».
 *
 * ⚠️ CAUSE N°1 DES OPPORTUNITÉS 1xBet+1win PERDUES (96 refus sur 200 relevés le
 * 07/09/2026, tous sur la famille « 1X2 — X + 12 ») : nos scanners écrivent
 * cette jambe « Un gagnant (12) ». Le code réel — « 12 » — est DANS LA
 * PARENTHÈSE, or les parenthèses étaient supprimées avant toute lecture (elles
 * portent d'habitude une précision de marché, « Domicile (DNB) »). Résultat :
 * libellé réduit à « un gagnant », inconnu de tous les motifs → camp attendu
 * « ? » et jambe cherchée dans le groupe 1X2 au lieu du groupe Double chance,
 * d'où « non identifiable — candidats vus : Match Nul, Alanyaspor U19… ».
 * La parenthèse est donc lue AVANT d'être écartée quand elle contient un code
 * de double chance, et « un gagnant » / « pas de match nul » valent « 12 ».
 */
export function dcCodeOf(label: unknown): "1x" | "x2" | "12" | null {
  const raw = norm(label);
  const inParens = raw.match(/\(([^)]*)\)/)?.[1]?.replace(/\s/g, "") || "";
  if (/^(1x|x2|12)$/.test(inParens)) return inParens as "1x" | "x2" | "12";
  const flat = raw.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\.(?!\d)/g, "").replace(/\s/g, "");
  // ⚠️ Nos scanners abrègent les camps : « Nul ou Ext. » devenait « nulouext »,
  // absent de toutes les listes → camp attendu « ? » et jambe perdue (mesuré
  // le 15/09/2026 sur « 2 Mi-temps. Résultat final »). Les formes abrégées
  // « dom » / « ext » sont donc reconnues au même titre que les formes longues.
  if (/^(1x|domicileounul|nuloudomicile|domounul|nuloudom|1ounul|nulou1|homeordraw|draworhome)$/.test(flat)) return "1x";
  if (/^(x2|nulouexterieur|exterieurounul|nulouext|extounul|2ounul|nulou2|draworaway|awayordraw)$/.test(flat)) return "x2";
  if (/^(12|domicileouexterieur|exterieuroudomicile|domouext|extoudom|homeoraway|awayorhome|1ou2|2ou1|pasdenul|pasdematchnul|nonul|nodraw|ungagnant|onewinner)$/.test(flat)) return "12";
  return null;
}

/** Marché / libellé « Pair — Impair » (Odd/Even). */
export const isOddEvenFamily = (family: string) => /\b(pair|impair|paire|impaire|odd|even)\b/.test(norm(family));
export const isOddEvenLabel = (label: unknown) => /^(pair|impair|paire|impaire|odd|even)$/.test(norm(label));

export function isDoubleChanceLabel(label: unknown): boolean {
  if (dcCodeOf(label)) return true;
  const l = norm(label).replace(/\s*\([^)]*\)\s*/g, " ").replace(/\.(?!\d)/g, "").replace(/\s/g, "");
  return DC_LABEL.test(l);
}

/**
 * Famille du scanner → test de reconnaissance du groupe 1win correspondant.
 * `label` (le libellé de la jambe) est déterminant sur les paires croisées :
 * il prime sur la famille pour choisir le marché à ouvrir.
 */
export function groupMatcher(family: string, teams?: { home?: string; away?: string }, label?: unknown): (groupName: string) => boolean {
  const base = baseMatcher(family, teams, label);
  const unit = unitOf(family);
  return (g) => base(g) && groupHasUnit(g, unit);
}

function baseMatcher(family: string, teams?: { home?: string; away?: string }, label?: unknown): (groupName: string) => boolean {
  const f = norm(family);
  const period = periodOf(f);

  // DNB : groupe DNB natif, sinon handicap (ligne 0 imposée par le résolveur).
  // Jamais le résultat 1X2 — c'est un autre pari.
  if (isDnbFamily(f)) {
    return (g) => {
      const n = norm(g);
      const isDnb = hasKw(n, DNB_KW);
      const isHcp = !isDnb && hasKw(n, KW.handicap) && !hasKw(n, KW.total);
      if (!isDnb && !isHcp) return false;
      return period ? groupHasPeriod(n, period) : !isPeriodGroup(n);
    };
  }

  // Le type de marché, indépendamment de la période.
  // La jambe double chance impose son groupe, même quand la famille annonce
  // « 1X2 » (paires croisées « 1X2 — 2 + 1X »).
  const kind: keyof typeof KW =
    isOddEvenLabel(label) || isOddEvenFamily(f) ? "oddEven"
    : isDoubleChanceLabel(label) ? "doubleChance"
    : f.includes("double") ? "doubleChance"
    : (f.includes("btts") || f.includes("deux equipes")) ? "btts"
    : f.includes("handicap") ? "handicap"
    : (/\btotal|over|under|plus de|moins de/.test(f)) ? "total"
    : "result";

  // Total d'une équipe → groupe « <nom de l'équipe> total » (match entier seulement).
  const side = teamTotalSide(f);
  // « Total Jeux J1 » : « jeux » est l'UNITÉ de comptage (tennis, tennis de
  // table), pas une période. Le traiter comme une période faisait renoncer à
  // tous ces marchés (« total d'équipe sur période : trop ambigu »).
  const sidePeriod = period === "games" ? null : period;
  if (side && !sidePeriod) {
    const team = norm(side === "home" ? teams?.home : teams?.away);
    const num = side === "home" ? "1" : "2";
    // 1win nomme ces marchés de DEUX façons : « <nom de l'équipe> total »
    // (football) et « Total 1 » / « Total 2 » (tennis, tennis de table).
    // La seconde forme manquait : tous ces marchés étaient déclarés absents.
    return (g) => {
      const n = norm(g);
      if (n === `total ${num}` || n === `total joueur ${num}` || n === `total equipe ${num}`) return true;
      // Basket : 1win ne publie le total d'équipe QUE prolongation incluse
      // (« Kauno Zalgiris II total (inc OT) ») — c'est le seul groupe d'équipe du match.
      const m = n.match(/^(.+?) total( \(inc ot\))?$/);
      // « 1st period. X total », « 1st half. X total » : une PÉRIODE, jamais le match.
      if (!team || !m || /[.:]|\b(period|half|mi-temps|quarter|quart|set|inning|map)\b/.test(m[1])) return false;
      if (m[1] === team) return true;
      // 1win abrège souvent le nom (« Admiral » pour « Admiral Vladivostok ») :
      // appariement souple, mais jamais si le nom correspond AUSSI à l'adversaire.
      const other = side === "home" ? teams?.away : teams?.home;
      return sameTeam(m[1], team) && !sameTeam(m[1], other);
    };
  }
  if (side && sidePeriod) return () => false; // total d'équipe sur une période : trop ambigu, on s'abstient

  return (g) => {
    const n = norm(g);
    if (!hasKw(n, KW[kind])) return false;
    // Un « Total pair/impair » n'est ni un total de buts ni un résultat : les
    // autres types ne doivent jamais tomber dessus, et inversement.
    if (kind !== "oddEven" && hasKw(n, KW.oddEven)) return false;
    // Un « handicap » ne doit pas être pris pour un « total », et inversement :
    // on écarte les groupes qui portent AUSSI un autre mot-clé fort.
    if (kind === "total" && hasKw(n, KW.handicap)) return false;
    if (kind === "result" && (hasKw(n, KW.total) || hasKw(n, KW.handicap) || hasKw(n, KW.doubleChance))) return false;
    // Tennis / tennis de table : les handicaps et totaux sont exprimés en JEUX
    // par défaut chez 1win, dont le groupe s'appelle simplement « Handicap » /
    // « Total » sans le mot « jeux ». On accepte donc aussi le groupe sans période.
    if (period === "games") return /\b(jeux|games)\b/.test(n) || !isPeriodGroup(n);
    // Autres périodes : correspondance stricte des deux côtés.
    if (period) return groupHasPeriod(n, period);
    return !isPeriodGroup(n);
  };
}

/** Ligne visée par un libellé de sélection ("Plus de 2.5" → 2.5). */
export function lineOf(label: unknown): number | null {
  const m = norm(label).replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * Libellé désignant UNIQUEMENT un camp, sans aucune ligne :
 * « Joueur 2 », « J1 », « T2 », « Équipe 1 », « 1 », « 2 », « X »…
 */
const PURE_SIDE = /^((joueur|player|equipe|team)\s*[12]|[jtep][12]|[12]|x|nul|draw|domicile|home|exterieur|away|1x|x2|12)$/;

/**
 * Ligne RÉELLEMENT visée par une sélection.
 *
 * ⚠️ CAUSE DE NOMBREUSES OPPORTUNITÉS MANQUÉES : « Joueur 2 » était lu comme
 * la ligne « 2 ». Le moteur cherchait alors une cote de ligne 2 dans le marché
 * « Vainqueur » (qui n'en a aucune) et refusait de jouer, alors que la
 * sélection existait bel et bien. Un chiffre de camp n'est PAS une ligne.
 */
export function selectionLine(label: unknown): number | null {
  const l = norm(label);
  if (PURE_SIDE.test(l)) return null;
  // Ligne = nombre décimal, ou nombre explicitement signé (« J1 +1.5 », « -2 »).
  const m = l.replace(",", ".").match(/[+-]?\d+\.\d+|[+-]\d+/);
  if (m) return Number(m[0].replace("+", ""));
  // « Plus de 2 » / « Over 3 » : la ligne suit un mot de comparaison.
  const cmp = l.match(/(?:plus de|moins de|over|under|au-dessus de|au-dessous de|total)\s*(\d+(?:\.\d+)?)/);
  return cmp ? Number(cmp[1]) : null;
}

/**
 * LA LIGNE VOISINE EST-ELLE STRICTEMENT PLUS FAVORABLE QUE CELLE DEMANDÉE ?
 *
 * En direct, la ligne bouge : le scanner voit « Moins de 120.5 » chez 1win et,
 * deux secondes plus tard, 1win n'affiche plus que 119.5. Refuser tout écart
 * faisait perdre 6 opportunités sur 39 le 12/09/2026, alors qu'une ligne
 * DÉCALÉE EN NOTRE FAVEUR ne peut que gagner plus souvent que celle prévue :
 *   • « plus de »  → une ligne PLUS BASSE est plus facile à gagner ;
 *   • « moins de » → une ligne PLUS HAUTE est plus facile à gagner ;
 *   • handicap     → une ligne PLUS HAUTE pour le camp joué est plus favorable.
 * L'inverse (ligne plus dure) reste refusé, et l'écart est borné à 1 point pour
 * ne jamais transformer le pari en un autre pari. La cote réellement lue est
 * ensuite revalidée : si la marge disparaît, rien n'est engagé.
 */
export function isFavourableLine(candidate: number, wanted: number, side: string, family?: string): boolean {
  if (!Number.isFinite(candidate) || !Number.isFinite(wanted)) return false;
  if (candidate === wanted || Math.abs(candidate - wanted) > 1.0001) return false;
  if (side === "over") return candidate < wanted;
  if (side === "under") return candidate > wanted;
  if ((side === "1" || side === "2") && norm(family).includes("handicap")) return candidate > wanted;
  return false;
}

/**
 * Côté visé par le libellé de notre scanner, ramené au vocabulaire `outcome`
 * de 1win : over / under / yes / no / x / 1 / 2.
 */
export function wantedOutcome(label: string, teams?: { home?: string; away?: string }, family?: string): string {
  const l = norm(label);
  // ⚠️ CAUSE D'UN PARI POSÉ DEUX FOIS DU MÊME CÔTÉ (22/08/2026) :
  // « Domicile (DNB) » ne correspondait à AUCUN motif de camp (les motifs
  // exigent une correspondance exacte) → côté « inconnu » → aucune
  // vérification possible, et l'identifiant fourni par le scanner était joué
  // tel quel, même quand il désignait l'équipe adverse.
  // Le qualificatif entre parenthèses est une précision de marché, jamais un
  // camp : on l'écarte avant de reconnaître le camp.
  // ⚠️ CAUSE N°1 DE « MARCHÉ INTROUVABLE » (mesurée : ~45 % des refus) : nos
  // scanners abrègent les camps en « Dom. » et « Ext. ». Le point final faisait
  // échouer TOUS les motifs de camp (qui exigent une correspondance exacte) →
  // camp attendu « ? » → aucune sélection ne pouvait atteindre le seuil, alors
  // que la bonne cote était bel et bien dans la liste. On retire donc les points
  // d'abréviation, jamais ceux d'un nombre décimal.
  const lBase = l.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\.(?!\d)/g, "").replace(/\s+/g, " ").trim();

  // Pair / Impair : le camp est le libellé lui-même.
  if (/^(pair|paire|even)$/.test(lBase)) return "even";
  if (/^(impair|impaire|odd)$/.test(lBase)) return "odd";

  // Double chance reconnue en priorité, parenthèse comprise (« Un gagnant (12) »).
  const dcCode = dcCodeOf(label);
  if (dcCode) return dcCode;

  // Total d'une équipe : « Dom. +0.5 » = plus de, « Dom. −0.5 » = moins de.
  //
  // ⚠️ CAUSE MAJEURE D'OPPORTUNITÉS PERDUES (mesurée : ~70 refus en 400
  // tentatives, tennis de table surtout). Deux défauts cumulés :
  //   • « Au-Dessus De 56.5 » (le libellé RÉEL de 1win pour « plus de ») n'était
  //     reconnu par AUCUN motif de ce bloc ;
  //   • le tiret de « Au-Dessus » était pris pour un signe moins → la sélection
  //     était déclarée « moins de », d'où « camp under au lieu de over » et
  //     l'abandon de l'opportunité alors que la cote était la BONNE.
  // Le signe ne compte donc que s'il précède réellement un nombre.
  if (family && teamTotalSide(family)) {
    if (/(plus de|over|dessus)/.test(l) || /\+\s*\d/.test(l)) return "over";
    if (/(moins de|under|dessous)/.test(l) || /-\s*\d/.test(l)) return "under";
    return "";
  }
  // Handicap : le signe porte la ligne, le mot porte le côté joué.
  if (family && norm(family).includes("handicap")) {
    // ⚠️ « J1 +1.5 » était lu « over » (à cause du +) au lieu du camp 1 :
    // les abréviations de camp sont donc testées AVANT tout signe.
    if (/^(dom|domicile|home|1|j1|t1|e1|p1|joueur 1|equipe 1|team 1)\b/.test(lBase)) return "1";
    if (/^(ext|exterieur|away|2|j2|t2|e2|p2|joueur 2|equipe 2|team 2)\b/.test(lBase)) return "2";
  }

  if (/(^|\W)(over|plus de|au-dessus|\+)/.test(l)) return "over";
  if (/(^|\W)(under|moins de|au-dessous)/.test(l)) return "under";
  if (/\b(oui|yes)\b/.test(l)) return "yes";
  if (/\b(non|no)\b/.test(l)) return "no";
  if (/^(x|nul|match nul|draw)$/.test(lBase)) return "x";
  // Double chance (avant les côtés simples : ces libellés contiennent « domicile »).
  const dc = lBase.replace(/\s/g, "");
  if (/^(1x|12|x2)$/.test(dc)) return dc;
  if (/^(domicileounul|nuloudomicile|homeordraw|1ounul)$/.test(dc)) return "1x";
  if (/^(nulouexterieur|exterieurounul|draworaway|2ounul)$/.test(dc)) return "x2";
  if (/^(domicileouexterieur|homeoraway|pasdenul|nonul)$/.test(dc)) return "12";
  if (/^1$/.test(lBase)) return "1";
  if (/^2$/.test(lBase)) return "2";
  // Côtés simples : domicile / extérieur, y compris libellés « Joueur 1/2 ».
  if (/^(dom|domicile|home|(joueur|player|equipe|team)\s*1|j1|t1|e1|p1|1er (joueur|jouer))$/.test(lBase)) return "1";
  if (/^(ext|exterieur|away|(joueur|player|equipe|team)\s*2|j2|t2|e2|p2|2e(me)? joueur)$/.test(lBase)) return "2";
  const home = norm(teams?.home);
  const away = norm(teams?.away);
  if (home && (lBase === home || home.includes(lBase) || lBase.includes(home))) return "1";
  if (away && (lBase === away || away.includes(lBase) || lBase.includes(away))) return "2";
  return "";
}