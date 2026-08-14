// Normalisation et fuzzy matching de noms d'equipes.
// Port fidele de matchCore.ts (norm/tokenOverlap/acronymMatch/levenshtein/teamSim).
const DIACRITICS = /[̀-ͯ]/g;

// Aliases FR/DE/DK/ES/IT/RU → forme canonique (souvent proche du nom local ou anglais).
// Applique AVANT tokenisation : toutes les variantes convergent vers 1 clé.
// Objectif : matcher "FC Copenhague" (Sportcash FR) avec "FC Kobenhavn" (1xBet).
// Chaque entrée : ligne = FR/variant, valeur = clé canonique (unique par entité).
const CITY_ALIASES = new Map([
  // Danemark
  ['copenhague', 'copen'], ['copenhagen', 'copen'], ['kobenhavn', 'copen'], ['kobenhaven', 'copen'],
  // Allemagne
  ['munich', 'munch'], ['muenchen', 'munch'], ['munchen', 'munch'],
  ['cologne', 'koln'], ['koeln', 'koln'],
  ['nuremberg', 'nurn'], ['nurnberg', 'nurn'], ['nuernberg', 'nurn'],
  ['brunswick', 'brau'], ['braunschweig', 'brau'],
  ['hanovre', 'hann'], ['hannover', 'hann'], ['hanover', 'hann'],
  ['mayence', 'mainz'], ['mainz', 'mainz'],
  ['sarrebruck', 'saar'], ['saarbrucken', 'saar'], ['saarbruecken', 'saar'],
  // Autriche
  ['vienne', 'wien'], ['vienna', 'wien'], ['wien', 'wien'],
  ['salzbourg', 'salz'], ['salzburg', 'salz'],
  // Espagne
  ['seville', 'sevi'], ['sevilla', 'sevi'], ['sevilha', 'sevi'],
  ['barcelone', 'barc'], ['barcelona', 'barc'],
  ['saragosse', 'zara'], ['zaragoza', 'zara'],
  ['grenade', 'gran'], ['granada', 'gran'],
  ['saint sebastien', 'donost'], ['san sebastian', 'donost'], ['donostia', 'donost'],
  // Italie
  ['naples', 'napo'], ['napoli', 'napo'],
  ['rome', 'roma'], ['roma', 'roma'],
  ['turin', 'tori'], ['torino', 'tori'], ['juventus', 'juve'], ['juve', 'juve'],
  ['florence', 'fior'], ['fiorentina', 'fior'],
  ['milan', 'mila'], ['milano', 'mila'],
  ['genes', 'geno'], ['gênes', 'geno'], ['genoa', 'geno'], ['genova', 'geno'],
  // Suisse
  ['saint gall', 'stgall'], ['st gall', 'stgall'], ['st gallen', 'stgall'], ['sankt gallen', 'stgall'],
  ['geneve', 'gene'], ['geneva', 'gene'], ['genf', 'gene'],
  ['bale', 'basel'], ['bâle', 'basel'], ['basel', 'basel'], ['basle', 'basel'],
  ['zurich', 'zuri'], ['zürich', 'zuri'],
  // Belgique
  ['bruges', 'brug'], ['brugge', 'brug'],
  ['anvers', 'antw'], ['antwerpen', 'antw'], ['antwerp', 'antw'],
  ['gand', 'gent'], ['gent', 'gent'], ['ghent', 'gent'],
  ['liege', 'liege'], ['luik', 'liege'],
  // Pays-Bas
  ['la haye', 'haag'], ['den haag', 'haag'], ['the hague', 'haag'],
  // République Tchèque
  ['prague', 'prah'], ['praha', 'prah'],
  // Russie / Est
  ['moscou', 'mosc'], ['moscow', 'mosc'], ['moskva', 'mosc'],
  ['saint petersbourg', 'stpet'], ['saint petersburg', 'stpet'], ['saint-petersbourg', 'stpet'], ['st petersburg', 'stpet'],
  ['zenit', 'zeni'],
  // Portugal
  ['lisbonne', 'lisb'], ['lisbon', 'lisb'], ['lisboa', 'lisb'],
  ['porto', 'port'], ['fc porto', 'port'],
  // Grèce
  ['athenes', 'ath'], ['athens', 'ath'], ['atenas', 'ath'],
  ['salonique', 'thes'], ['thessalonique', 'thes'], ['thessaloniki', 'thes'],
  // Turquie
  ['istanbul', 'ista'], ['constantinople', 'ista'],
  // Serbie
  ['belgrade', 'beog'], ['beograd', 'beog'],
  ['etoile rouge', 'crvz'], ['red star', 'crvz'], ['crvena zvezda', 'crvz'],
  ['partizan', 'part'],
  // Ukraine
  ['kiev', 'kyiv'], ['kiew', 'kyiv'], ['kyiv', 'kyiv'],
  ['dynamo kiev', 'dynkyiv'], ['dynamo kyiv', 'dynkyiv'],
  ['shakhtar', 'shak'], ['chakhtar', 'shak'],
  // Bosnie
  ['sarajevo', 'sara'],
  // Angleterre common variants
  ['man united', 'manu'], ['manchester united', 'manu'], ['man utd', 'manu'],
  ['man city', 'manc'], ['manchester city', 'manc'],
  ['spurs', 'tott'], ['tottenham', 'tott'], ['tottenham hotspur', 'tott'],
  // France (déjà en français partout, peu d'alias)
  ['psg', 'psg'], ['paris sg', 'psg'], ['paris saint germain', 'psg'], ['paris saint-germain', 'psg'],
  ['om', 'olymar'], ['olympique marseille', 'olymar'], ['marseille', 'olymar'],
  ['ol', 'olylyon'], ['olympique lyonnais', 'olylyon'], ['olympique lyon', 'olylyon'], ['lyon', 'olylyon'],
  ['asse', 'stet'], ['saint etienne', 'stet'], ['as saint etienne', 'stet'], ['saint-etienne', 'stet'],
  ['stade rennais', 'renn'], ['rennes', 'renn'],
]);

// Applique les aliases en pré-normalisation. Remplace chaque terme trouvé (word boundary).
function applyAliases(s) {
  const lower = ' ' + (s || '').toLowerCase().normalize('NFD').replace(DIACRITICS, '') + ' ';
  let out = lower;
  for (const [k, v] of CITY_ALIASES) {
    // Word boundary : espace avant et après ou début/fin
    const re = new RegExp(`(^|[^a-z0-9])${k}([^a-z0-9]|$)`, 'g');
    out = out.replace(re, `$1${v}$2`);
  }
  return out.trim();
}

// Tokens de CATEGORIE / GENRE (u20, women, reserves, ii...) : ce ne sont jamais
// des noms d'equipe. Ils sont deja verifies separement (modifiersMatch dans
// matching.js) et, laisses dans la tokenisation, ils gonflaient artificiellement
// teamSim : tokenOverlap divise par min(nb tokens), donc "Comercial Tiete U20"
// vs "EC XV de Jau U20" partageaient le seul token "u20" -> overlap 1/2 = 0.50,
// au-dessus du seuil kickoff-tight (0.40). Comme tous les matchs d'un
// championnat de jeunes demarrent a la meme heure, dt=0 n'ecartait rien :
// "Palmeiras Sao Joao U20 vs Comercial Tiete U20" (Serie B U20) etait apparie a
// "SE Palmeiras U20 vs EC XV de Jau U20" (Serie A U20) chez BetMomo -> surebets
// fantomes a +56% sur un match introuvable chez l'autre book.
const CATEGORY_TOKENS = /\b(u1[5-9]|u2[0-3]|women|wom|femmes|feminin|dames|ladies|youth|junior|jrs?|reserves?|amateur|iii|ii)\b/g;

export function norm(s) {
  return applyAliases(s).toLowerCase()
    .replace(/\b(fc|cf|sc|ac|afc|cd|ec|sd|fk|as|us|ss|rfc|bsc|vfb|tsv|sv|rc|ogc|ssc|club|deportivo|universidad|u\.|de|del|do|da|et|les|the|al|el)\b/g, ' ')
    .replace(CATEGORY_TOKENS, ' ')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function tokenOverlap(a, b) {
  const ta = new Set(norm(a).split(' ').filter((w) => w.length >= 3));
  const tb = new Set(norm(b).split(' ').filter((w) => w.length >= 3));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

export function fuzzyEq(wa, wb) {
  if (wa === wb) return true;
  const lo = Math.min(wa.length, wb.length);
  // Chaines courtes (<5) : exiger égalité stricte pour éviter faux positifs
  // sur des IDs canoniques d'aliases (ex: manu/manc, brau/brug, wien/wiel).
  if (lo < 5) return false;
  const d = levenshtein(wa, wb);
  // <=6 : max 1 diff. >6 : max 2 diff.
  return d <= (Math.max(wa.length, wb.length) <= 6 ? 1 : 2);
}

// Detecte si un nom court est l'ACRONYME d'un nom long (PSG↔Paris Saint Germain).
export function acronymMatch(a, b) {
  const acr = (s) => {
    const raw = (s || '').normalize('NFD').replace(DIACRITICS, '').trim();
    const words = raw.split(/\s+/).filter(Boolean);
    if (words.length !== 1) return null;
    const w = words[0];
    if (w.length < 2 || w.length > 5) return null;
    return w.toLowerCase().replace(/[^a-z]/g, '');
  };
  const initials = (s) => (s || '').normalize('NFD').replace(DIACRITICS, '')
    .split(/\s+/).filter((w) => w.length >= 2 && /^[a-z]/i.test(w))
    .map((w) => w[0].toLowerCase()).join('');
  const isSub = (ac, longN) => {
    const letters = (longN || '').normalize('NFD').replace(DIACRITICS, '').toLowerCase().replace(/[^a-z]/g, '');
    let i = 0;
    for (const ch of letters) { if (ch === ac[i]) i++; if (i === ac.length) return true; }
    return false;
  };
  const tryOne = (shortN, longN) => {
    const ac = acr(shortN);
    if (!ac || ac.length < 2) return false;
    const ini = initials(longN);
    if (ini.length >= 2 && ini.includes(ac)) return true;
    const words = (longN || '').trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2 && ini[0] === ac[0] && isSub(ac, longN)) return true;
    return false;
  };
  return tryOne(a, b) || tryOne(b, a);
}

// Jaro-Winkler : mesure de similarité 0..1 tolérante aux variantes orthographiques.
// jaroWinkler("copenhague", "copenhagen") ~ 0.94, "kobenhavn" ~ 0.55
// Génère des scores utiles SANS dictionnaire → attrape variantes orthographiques
// de petites équipes exotiques non listées dans CITY_ALIASES.
export function jaroWinkler(s1, s2) {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  const m = s1.length, n = s2.length;
  const matchDistance = Math.max(0, Math.floor(Math.max(m, n) / 2) - 1);
  const s1Matches = new Array(m).fill(false);
  const s2Matches = new Array(n).fill(false);
  let matches = 0;
  for (let i = 0; i < m; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, n);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0, k = 0;
  for (let i = 0; i < m; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  transpositions = Math.floor(transpositions / 2);
  const jaro = (matches / m + matches / n + (matches - transpositions) / matches) / 3;
  // Winkler boost : bonus pour préfixe commun (max 4 chars)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, m, n); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

// Similarite TOLERANTE d'equipe (overlap + prefixe + acronyme + fuzzy + Jaro-Winkler).
// Jaro-Winkler ajoute comme filet de sécurité : capte variantes orthographiques
// non listées dans CITY_ALIASES (ex : Kylian↔Killian, Baumgartner↔Baumgartler).
export function teamSim(a, b) {
  const base = tokenOverlap(a, b);
  if (acronymMatch(a, b)) return Math.max(base, 1);
  const ta = norm(a).split(' ').filter((w) => w.length >= 3);
  const tb = norm(b).split(' ').filter((w) => w.length >= 3);
  if (!ta.length || !tb.length) return base;
  let inter = 0;
  for (const wa of ta) {
    if (tb.some((wb) => wa === wb
      || (wa.length >= 4 && wb.startsWith(wa))
      || (wb.length >= 4 && wa.startsWith(wb))
      || fuzzyEq(wa, wb)
      || (Math.min(wa.length, wb.length) >= 6 && jaroWinkler(wa, wb) >= 0.90))) inter++;
  }
  const tokScore = inter / Math.min(ta.length, tb.length);
  // Fallback JW sur chaine complète : min 8 chars pour éviter faux positifs
  // sur acronymes courts (manu vs manc jw=0.87 = faux positif à éviter).
  const na = ta.join('');
  const nb = tb.join('');
  const jwFull = (na.length >= 8 && nb.length >= 8) ? jaroWinkler(na, nb) : 0;
  return Math.max(base, tokScore, jwFull >= 0.88 ? jwFull : 0);
}
