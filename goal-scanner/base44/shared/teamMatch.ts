// ═══════════════════════════════════════════════════════════════════
// APPARIEMENT D'ÉQUIPES ENTRE BOOKMAKERS.
//
// Chaque bookmaker écrit les noms dans sa langue : « Barcelone » (1xBet),
// « Barcelona FC » (1win), « FC Barcelone » (Congobet), « Barcelona »
// (betPawa). Une comparaison mot à mot stricte faisait échouer TOUS les
// grands clubs — d'où les matchs « introuvables » chez 1win et betPawa.
//
// Règles : on compare les mots significatifs (≥ 4 lettres, hors FC/SC/CF…).
// Deux mots correspondent s'ils sont identiques ou partagent leurs 5
// premières lettres (barcelone ≈ barcelona, munchen ≈ munich → non, mais
// c'est volontairement prudent). TOUS les mots du nom le plus court doivent
// trouver un partenaire : « Manchester United » ne peut donc pas être pris
// pour « Manchester City ».
// ═══════════════════════════════════════════════════════════════════

const NOISE = /\b(fc|sc|ac|cf|afc|cd|cp|ss|as|club|de|del|la|le|les|the)\b/g;

/**
 * QUALIFICATIFS D'ÉQUIPE — même mot, deux langues.
 *
 * Signalé le 11/09/2026 : un bookmaker écrit « Jeunes », l'autre « Youth ».
 * Le qualificatif est un mot OBLIGATOIRE de l'appariement (c'est lui qui
 * distingue l'équipe première de sa catégorie de jeunes), donc il ne trouvait
 * aucun partenaire et un surebet parfaitement valide n'était jamais placé.
 * On ramène ces qualificatifs à une forme unique AVANT comparaison — sans
 * jamais les supprimer, pour que « Osasuna » ne puisse pas être pris pour
 * « Osasuna Youth ».
 */
const QUALIFIERS: [RegExp, string][] = [
  [/\b(jeunes?|espoirs?|junior|juniors|jugend|juvenil|giovanili|youth)\b/g, "youth"],
  [/\b(reserves?|reservas|riserve|reserve)\b/g, "reserve"],
  // « (w) » est l'abréviation la plus répandue de « Women » : elle manquait, donc
  // « Sokol Stara Bela (w) » et « Sokol Stara Bela (Women) » — le MÊME match —
  // étaient déclarés différents et l'opportunité abandonnée (relevé le
  // 12/09/2026 sur les paires 1xBet+1win, aucune mise n'est jamais partie).
  [/\b(feminin|feminine|feminins|femmes|dames|femenino|femminile|frauen|ladies|women|wome|w)\b/g, "women"],
  [/\bmoins\s*de\s*(\d{2})\b/g, "u$1"],
  [/\bunder\s*(\d{2})\b/g, "u$1"],
  // ⚠️ 22/09/2026 — 1xBet écrit la catégorie d'âge entre parenthèses :
  // « Botswana (20) » là où le scanner lit « Botswana U20 ». Les parenthèses
  // étant transformées en espaces, il restait le mot « 20 » sans partenaire :
  // le garde-fou d'identité déclarait « ce marché appartient à un autre match »
  // et l'opportunité était abandonnée (5 abandons sur ce seul match).
  [/\b(\d{2})\b(?!\s*\d)/g, "u$1"],
];

/**
 * SÉLECTIONS NATIONALES — même pays, deux langues.
 *
 * ⚠️ REFUS RÉEL DU 17/09/2026 : « Bangladesh (Women) vs South Korea (Women) »
 * (scanner) et « Bangladesh (Femmes) vs Corée du Sud (Femmes) » (1xBet) sont le
 * MÊME match, mais « coree sud » ne ressemble à « south korea » par aucune règle
 * de translittération : le garde-fou d'identité déclarait « ce marché appartient
 * à un autre match » et l'opportunité était abandonnée. Les noms de pays se
 * traduisent, ils ne se translittèrent pas : il faut donc un vocabulaire.
 * Chaque pays est ramené à sa forme anglaise avant toute comparaison.
 */
const COUNTRIES: [RegExp, string][] = [
  [/\bcoree du sud\b/g, "south korea"], [/\bcoree du nord\b/g, "north korea"],
  [/\bafrique du sud\b/g, "south africa"], [/\bnouvelle zelande\b/g, "new zealand"],
  [/\betats unis\b/g, "usa"], [/\bpays bas\b/g, "netherlands"], [/\bhollande\b/g, "netherlands"],
  [/\barabie saoudite\b/g, "saudi arabia"], [/\bemirats arabes unis\b/g, "uae"],
  [/\bcote d ivoire\b/g, "ivory coast"], [/\brepublique tcheque\b/g, "czechia"],
  [/\bczech republic\b/g, "czechia"], [/\btchequie\b/g, "czechia"],
  [/\ballemagne\b/g, "germany"], [/\bangleterre\b/g, "england"], [/\bespagne\b/g, "spain"],
  [/\bitalie\b/g, "italy"], [/\bautriche\b/g, "austria"], [/\bbelgique\b/g, "belgium"],
  [/\bsuisse\b/g, "switzerland"], [/\bsuede\b/g, "sweden"], [/\bnorvege\b/g, "norway"],
  [/\bdanemark\b/g, "denmark"], [/\bfinlande\b/g, "finland"], [/\bislande\b/g, "iceland"],
  [/\bpologne\b/g, "poland"], [/\bhongrie\b/g, "hungary"], [/\broumanie\b/g, "romania"],
  [/\bbulgarie\b/g, "bulgaria"], [/\bgrece\b/g, "greece"], [/\bturquie\b/g, "turkey"],
  [/\bcroatie\b/g, "croatia"], [/\bserbie\b/g, "serbia"], [/\bslovenie\b/g, "slovenia"],
  [/\bslovaquie\b/g, "slovakia"], [/\bukraine\b/g, "ukraine"], [/\brussie\b/g, "russia"],
  [/\bbielorussie\b/g, "belarus"], [/\blituanie\b/g, "lithuania"], [/\blettonie\b/g, "latvia"],
  [/\bestonie\b/g, "estonia"], [/\birlande\b/g, "ireland"], [/\becosse\b/g, "scotland"],
  [/\bgalles\b/g, "wales"], [/\bportugal\b/g, "portugal"], [/\bbresil\b/g, "brazil"],
  [/\bargentine\b/g, "argentina"], [/\bmexique\b/g, "mexico"], [/\bperou\b/g, "peru"],
  [/\bcolombie\b/g, "colombia"], [/\bchili\b/g, "chile"], [/\bjapon\b/g, "japan"],
  [/\bchine\b/g, "china"], [/\binde\b/g, "india"], [/\bthailande\b/g, "thailand"],
  [/\bindonesie\b/g, "indonesia"], [/\bmalaisie\b/g, "malaysia"], [/\bviet nam\b/g, "vietnam"],
  [/\begypte\b/g, "egypt"], [/\bmaroc\b/g, "morocco"], [/\btunisie\b/g, "tunisia"],
  [/\balgerie\b/g, "algeria"], [/\bnigeria\b/g, "nigeria"], [/\bsenegal\b/g, "senegal"],
  [/\bcameroun\b/g, "cameroon"], [/\bethiopie\b/g, "ethiopia"], [/\bkenya\b/g, "kenya"],
  [/\bouganda\b/g, "uganda"], [/\btanzanie\b/g, "tanzania"], [/\bzambie\b/g, "zambia"],
  [/\bghana\b/g, "ghana"], [/\baustralie\b/g, "australia"], [/\bcanada\b/g, "canada"],
  // ⚠️ 22/09/2026 — LE FLUX 1xBET EST EN FRANÇAIS, LE SCANNER EN ANGLAIS.
  // Relevé sur 4 jours : 22 opportunités 1xBet abandonnées au motif « ce marché
  // appartient à un autre match », alors qu'il s'agissait du MÊME match écrit
  // dans l'autre langue — « Nouvelle-Calédonie » vs « New Caledonia »,
  // « Îles Salomon » vs « Solomon Islands », « Archipel des Comores » vs
  // « Comoro Islands ». Aucun découvert, mais autant de paris valides perdus.
  [/\bnouvelle caledonie\b/g, "new caledonia"],
  [/\biles salomon\b/g, "solomon islands"], [/\bsolomon islands\b/g, "solomon islands"],
  [/\barchipel des comores\b/g, "comoros"], [/\bcomoro islands\b/g, "comoros"],
  [/\bcomores\b/g, "comoros"],
  [/\bpapouasie nouvelle guinee\b/g, "papua new guinea"],
  [/\bnouvelle guinee\b/g, "new guinea"], [/\bfidji\b/g, "fiji"],
  [/\btahiti\b/g, "tahiti"], [/\bvanuatu\b/g, "vanuatu"], [/\bsamoa\b/g, "samoa"],
  [/\biles cook\b/g, "cook islands"], [/\bnamibie\b/g, "namibia"],
  [/\bbotswana\b/g, "botswana"], [/\bmalawi\b/g, "malawi"],
  [/\bmozambique\b/g, "mozambique"], [/\bzimbabwe\b/g, "zimbabwe"],
  [/\blesotho\b/g, "lesotho"], [/\beswatini\b/g, "eswatini"], [/\bswaziland\b/g, "eswatini"],
  [/\bmaurice\b/g, "mauritius"], [/\bile maurice\b/g, "mauritius"],
  [/\bmadagascar\b/g, "madagascar"], [/\bseychelles\b/g, "seychelles"],
  [/\bangola\b/g, "angola"], [/\bgabon\b/g, "gabon"], [/\btchad\b/g, "chad"],
  [/\bsoudan du sud\b/g, "south sudan"], [/\bsoudan\b/g, "sudan"],
  [/\bguinee equatoriale\b/g, "equatorial guinea"], [/\bguinee bissau\b/g, "guinea bissau"],
  [/\bguinee\b/g, "guinea"], [/\bmauritanie\b/g, "mauritania"],
  [/\bburkina faso\b/g, "burkina faso"], [/\bbenin\b/g, "benin"], [/\btogo\b/g, "togo"],
  [/\bniger\b/g, "niger"], [/\bmali\b/g, "mali"], [/\brwanda\b/g, "rwanda"],
  [/\bburundi\b/g, "burundi"], [/\brepublique centrafricaine\b/g, "central african republic"],
  [/\brepublique democratique du congo\b/g, "dr congo"], [/\brd congo\b/g, "dr congo"],
  [/\bcongo brazzaville\b/g, "congo"], [/\bcap vert\b/g, "cape verde"],
  [/\bsierra leone\b/g, "sierra leone"], [/\bliberia\b/g, "liberia"],
  [/\bgambie\b/g, "gambia"], [/\bsomalie\b/g, "somalia"], [/\bdjibouti\b/g, "djibouti"],
  [/\berythree\b/g, "eritrea"], [/\blibye\b/g, "libya"],
];

export function normTeam(s: unknown): string {
  let out = String(s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ");
  for (const [rx, to] of COUNTRIES) out = out.replace(rx, to);
  for (const [rx, to] of QUALIFIERS) out = out.replace(rx, to);
  return out
    .replace(NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (s: unknown) => normTeam(s).split(" ").filter((w) => w.length >= 4);

/**
 * TRANSLITTÉRATIONS (russe, ukrainien, grec, arabe…).
 *
 * Le même club s'écrit « Ienisseï Krasnoïarsk » chez un bookmaker et « Yenisey
 * Krasnoyarsk » chez un autre : mot à mot, rien ne correspondait, et le
 * garde-fou d'identité de match refusait des arbitrages parfaitement valides
 * (constaté le 08/09/2026 sur Druzhba Maykop vs Ienisseï/Yenisey).
 * On ramène donc chaque mot à une forme commune : les variantes d'une même
 * consonne ou voyelle deviennent une seule lettre, et les doublements
 * (ss, nn, ll…) sont réduits.
 */
function translit(w: string): string {
  return w
    // ⚠️ RELEVÉ LE 12/09/2026 : « Zhetysu » (scanner) et « Jetyssou
    // Taldykourgan » (1xBet) sont le MÊME club kazakh — le russe « ж » s'écrit
    // « zh » en translittération anglaise et « j » en française. Sans cette
    // règle, l'identité du match était déclarée fausse et l'opportunité
    // abandonnée : 16 abandons sur ce seul match dans la journée.
    .replace(/zh/g, "j")    // zhetysu → jetysu
    .replace(/y/g, "i")     // yenisey → ienisei
    .replace(/kh/g, "h")    // khimki → himki
    .replace(/ou/g, "u")    // oufa → ufa
    .replace(/ck/g, "k")
    .replace(/(.)\1+/g, "$1"); // ienissei → ienisei
}

function wordMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.slice(0, 5) === b.slice(0, 5) && a.length >= 5 && b.length >= 5) return true;
  const ta = translit(a), tb = translit(b);
  if (ta === tb) return true;
  return ta.slice(0, 5) === tb.slice(0, 5) && ta.length >= 5 && tb.length >= 5;
}

/**
 * SIMPLE OU DOUBLE ? (tennis, tennis de table, beach-volley)
 *
 * ⚠️ CAUSE DE L'INCIDENT DU 04/09/2026 : « Rinderknech » (simple) et
 * « Rinderknech / Bublik » (double) partagent un nom. La règle « tous les mots
 * du nom le plus court trouvent un partenaire » déclarait donc les deux camps
 * identiques, et un pari de SIMPLE a été couvert par un pari de DOUBLE d'un
 * autre tournoi : deux matchs différents, donc zéro couverture.
 * Un camp à deux joueurs ne peut jamais désigner un camp à un seul joueur.
 */
const isPair = (s: unknown) => /[\/&]|\s\+\s|\band\b/i.test(String(s ?? ""));

/**
 * QUALIFICATIFS OBLIGATOIRES DES DEUX CÔTÉS.
 *
 * ⚠️ TROU DÉCOUVERT LE 12/09/2026 en écrivant les contrôles : la règle « tous
 * les mots du nom le plus court trouvent un partenaire » ne portait que sur le
 * nom LE PLUS COURT. « Zilina » (équipe masculine) était donc déclaré identique
 * à « Zilina Women », et « Osasuna » identique à « Osasuna Youth » — deux matchs
 * différents, donc zéro couverture en cas de mise. Un qualificatif présent d'un
 * côté doit désormais l'être des deux.
 */
const QUAL = /^(women|youth|reserve|u\d{2})$/;
const qualsOf = (s: unknown) =>
  [...new Set(normTeam(s).split(" ").filter((w) => QUAL.test(w)))].sort().join("|");

/** Les deux libellés désignent-ils la même équipe ? */
export function sameTeam(x: unknown, y: unknown): boolean {
  if (isPair(x) !== isPair(y)) return false;
  if (qualsOf(x) !== qualsOf(y)) return false;
  // ⚠️ NOMS COURTS REFUSÉS ALORS QU'ILS SONT IDENTIQUES (relevé le 16/09/2026 :
  // « MTG vs JSCS » déclaré différent de « MTG vs JSCS »). Les mots de moins de
  // 4 lettres étant écartés, ces noms ne laissaient AUCUN mot à comparer et
  // l'appariement échouait. Deux libellés identiques désignent la même équipe,
  // et à défaut de mot long on compare les mots courts.
  if (normTeam(x) && normTeam(x) === normTeam(y)) return true;
  let a = words(x), b = words(y);
  if (!a.length || !b.length) {
    const shortWords = (s: unknown) => normTeam(s).split(" ").filter((w) => w.length >= 2);
    a = shortWords(x); b = shortWords(y);
  }
  if (!a.length || !b.length) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.every((w) => long.some((v) => wordMatch(w, v)));
}

/**
 * Les deux camps lus chez un bookmaker désignent-ils bien le match attendu ?
 * L'ordre domicile / extérieur diffère d'un bookmaker à l'autre : les deux sens
 * sont donc acceptés. Renvoie null quand un nom manque (rien à vérifier).
 */
export function sameOpponents(
  o1: unknown, o2: unknown, home: unknown, away: unknown,
): boolean | null {
  const [a, b, h, w] = [o1, o2, home, away].map((v) => String(v ?? "").trim());
  if (!a || !b || !h || !w) return null;
  return (sameTeam(a, h) && sameTeam(b, w)) || (sameTeam(a, w) && sameTeam(b, h));
}

/** Le nom d'un match (« A - B ») correspond-il aux deux équipes attendues ? */
export function sameFixture(eventName: unknown, home: string, away: string): boolean {
  const [h, a] = String(eventName || "").split(/\s+[-–vs]{1,2}\s+/);
  return !!h && !!a && sameTeam(h, home) && sameTeam(a, away);
}