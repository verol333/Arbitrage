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

export function norm(s) {
  return applyAliases(s).toLowerCase()
    .replace(/\b(fc|cf|sc|ac|afc|cd|ec|sd|fk|as|us|ss|rfc|bsc|vfb|tsv|sv|rc|ogc|ssc|club|deportivo|universidad|u\.|de|del|do|da|et|les|the|al|el)\b/g, ' ')
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
  if (lo < 4) return false;
  const d = levenshtein(wa, wb);
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

// Similarite TOLERANTE d'equipe (overlap + prefixe + acronyme + fuzzy).
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
      || fuzzyEq(wa, wb))) inter++;
  }
  return Math.max(base, inter / Math.min(ta.length, tb.length));
}
