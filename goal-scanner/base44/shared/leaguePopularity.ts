// ═══════════════════════════════════════════════════════════════════
// NOTATION DES COMPÉTITIONS — source unique pour tous les collecteurs.
//
// Le nom du PAYS ne suffit jamais : « Angleterre. Ligue 1 » est la League One,
// « Hong Kong. Premier League » n'est pas la Premier League, « CAF Ligue des
// champions » n'est pas l'UEFA. Chaque motif nomme la compétition ET son
// pays/organisateur. Les formats mineurs (femmes, jeunes, réserves, amicaux,
// divisions régionales) sont relégués tout en bas et ne remontent jamais
// dans la sélection des meilleures affiches.
// ═══════════════════════════════════════════════════════════════════

const MINOR = /u-?1[5-9]\b|u-?2[0-3]\b|jeunes|youth|junior|primavera|r[eé]serve|amateur|espoirs|femmes?\b|feminin|féminin|women|ladies|dames|\(w\)|\(f\)|\bii\b|amica|friendly|regional|régional|division [3-5]|3\. liga|4\. liga|oberliga|regionalliga|landesliga|isthmian|southern league|northern league|northern premier|southern premier|national league|county|district|tercera|primera [cd]\b|serie d|eccellenza|npl |queensland|victoria|nouvelle-galles|kolmonen|kakkonen|liga 3|liga 4|liga 5/i;

const FOOTBALL: Array<[RegExp, number]> = [
  [/uefa|ligue des champions.*uefa|uefa.*(champions|europa|conference)/i, 100],
  [/(angleterre|england)[.\s-]*premier league\s*$/i, 96],
  [/(espagne|spain)[.\s-]*(la ?liga|primera divisi)\s*$/i, 95],
  // Le flux écrit « Championnat d'Italie. Série A » (accent) : sans le « é »
  // accepté, la Serie A tombait à la note des divisions inconnues.
  [/(italie|italy)[.\s-]*s[eé]rie a\s*$/i, 94],
  [/(allemagne|germany)[.\s-]*bundesliga\s*$/i, 94],
  [/^france[.\s-]*ligue 1\s*$/i, 92],
  [/coupe du monde|world cup(?!.*(u-?\d|club))/i, 90],
  [/copa libertadores|copa am[eé]rica|euro\s*20\d\d|championnat d'europe/i, 88],
  [/(pays-bas|netherlands|hollande)[.\s-]*eredivisie|portugal[.\s-]*(primeira liga|liga portugal)|(turquie|turkey)[.\s-]*s[uü]per lig\s*$/i, 82],
  [/(belgique|belgium)[.\s-]*(pro league|jupiler)|(écosse|ecosse|scotland)[.\s-]*premiership|(arabie|saudi)[.\s-]*(pro league|premier league)\s*$|\bmls\b|(brésil|bresil|brazil)[.\s-]*(serie a|s[eé]rie a)\s*$|(argentine|argentina)[.\s-]*(primera|liga profesional)/i, 78],
  [/(angleterre|england)[.\s-]*(championship|fa cup|coupe d'angleterre|carabao|efl cup|coupe de la ligue)|coupe de france|copa del rey|coppa italia|dfb[- ]pokal|(allemagne|germany)[.\s-]*2\. bundesliga|(espagne|spain)[.\s-]*(segunda|la ?liga 2)|(italie|italy)[.\s-]*s[eé]rie b|^france[.\s-]*ligue 2/i, 72],
  [/(autriche|austria|suisse|switzerland|grèce|grece|greece|danemark|denmark|norv[eè]ge|norway|su[eè]de|sweden|pologne|poland|croatie|croatia|tch[eè]que|czech|russie|russia|ukraine|mexique|mexico|japon|japan|cor[eé]e du sud|korea|chine|china|états-unis|usa|australie|australia)[.\s-]*(bundesliga|super league|super lig|superligaen|eliteserien|allsvenskan|ekstraklasa|hnl|liga mx|j\.?\s?league|k ligue 1|super ligue|a-league|ligue 1|premier league|division 1)\s*$/i, 60],
  [/caf|afrique|africa|asie|asia|afc\b|concacaf|conmebol|sudamericana/i, 58],
  [/champions league|ligue des champions|europa league|conference league/i, 45],
  [/ligue 2|serie b|liga 2|2\. liga|segunda|championship|league one|ligue 1|premier league|super league|division 1|pro league|first division|premi[eè]re division/i, 40],
  [/coupe|cup|copa|pokal|taça|taca/i, 35],
];

const BASKETBALL: Array<[RegExp, number]> = [
  [/^nba$|\bnba\b(?!.*(g[- ]league|summer|2k|sommet))/i, 100],
  [/euroligue|euroleague/i, 90],
  [/coupe du monde|world cup|jeux olympiques|olympi|eurobasket|championnat d'europe|jeux asiatiques|afrobasket|americup/i, 85],
  [/eurocup|liga endesa|\bacb\b|(italie|italy)[.\s-]*(serie a|lega)|(allemagne|germany)[.\s-]*bbl|(france)[.\s-]*(pro a|betclic [eé]lite|lnb)|(turquie|turkey)[.\s-]*(bsl|super ligue|süper lig)|vtb|(gr[eè]ce|greece)[.\s-]*(a1|basket league)|(espagne|spain)[.\s-]*liga|adriatic|\baba\b|(australie|australia)[.\s-]*nbl|(chine|china)[.\s-]*cba|(japon|japan)[.\s-]*b\.?league|(cor[eé]e|korea)[.\s-]*kbl|(argentine|argentina)[.\s-]*liga nacional|(brésil|bresil|brazil)[.\s-]*nbb|wnba|champions league|ligue des champions|fiba/i, 70],
  [/supercoupe|super cup|coupe|cup|copa|pokal/i, 45],
  [/(belgique|belgium|pays-bas|netherlands|pologne|poland|isra[eë]l|israel|lituanie|lithuania|r[eé]publique tch[eè]que|czech|serbie|serbia|croatie|croatia|slov[eé]nie|slovenia|finlande|finland|su[eè]de|sweden|danemark|denmark|portugal|roumanie|romania|hongrie|hungary|autriche|austria|suisse|switzerland|philippines|pba|nouvelle-z[eé]lande|new zealand|mexique|mexico|porto rico|puerto rico|uruguay|chili|chile|venezuela|liban|lebanon|iran|kazakhstan|tunisie|alg[eé]rie|[eé]gypte|egypt|maroc|morocco|s[eé]n[eé]gal|nigeria|angola)[.\s-]*(premi|first|division|liga|ligue|championnat|bnxt|lkl|nbl|superliga|super liga|basket)/i, 40],
  [/(turquie|turkey)[.\s-]*tbl|\btbl\b|leb oro|pro b|2\. bundesliga|prob\b|serie a2|a2\b|liga 2|second|deuxi[eè]me|ncaa|coll[eè]ge|college/i, 20],
  [/mlbl|amateur|regional|r[eé]gional|3x3|pr[eé]-saison|pre[- ]season|preseason|amica|friendly/i, 0],
];

const TENNIS: Array<[RegExp, number]> = [
  [/us open|roland|wimbledon|australian open|open d'australie|grand chelem|grand slam/i, 100],
  [/(atp|wta).*(finals|1000|indian wells|miami|monte[- ]carlo|madrid|rome|canad|cincinnati|shanghai|bercy)|coupe davis|davis cup|billie jean king|laver cup/i, 95],
  [/(atp|wta)(?!.*(qualif|challenger|125))/i, 85],
  [/(atp|wta).*qualif|wta 125/i, 45],
  [/challenger/i, 30],
  [/itf|world tennis|utr|exhibition|amica|friendly/i, 10],
];

const BY_SPORT: Record<string, Array<[RegExp, number]>> = {
  football: FOOTBALL,
  basketball: BASKETBALL,
  tennis: TENNIS,
};

export function leaguePopularity(name: string, sport = "football") {
  const label = String(name || "").trim();
  if (sport === "football" && MINOR.test(label)) return 5;
  if (sport === "basketball" && /amica|friendly|amicaux|mlbl|3x3|femmes?|women|\(w\)|u-?\d\d/i.test(label)) return 0;
  if (sport === "tennis" && /doubles?|femmes|juniors?|u-?\d\d|legends|l[eé]gendes/i.test(label)) return 0;
  const table = BY_SPORT[sport] || FOOTBALL;
  for (const [re, score] of table) if (re.test(label)) return score;
  return 10;
}