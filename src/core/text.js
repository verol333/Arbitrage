// Normalisation et fuzzy matching de noms d'equipes.
// Port fidele de matchCore.ts (norm/tokenOverlap/acronymMatch/levenshtein/teamSim).
const DIACRITICS = /[̀-ͯ]/g;

// Alias multilingue : les noms des equipes nationales (et quelques clubs)
// varient selon la langue du bookmaker (FR chez congobet/yellowbet, EN chez
// betmomo/apollo, IT chez sportcash). On mappe TOUTES les variantes vers un
// canonique unique (base EN) applique dans norm() avant token/fuzzy.
const TEAM_ALIASES = {
  // Equipes nationales — sources : FIFA / UEFA / CAF codes
  'angleterre': 'england', 'anglaterre': 'england', 'inghilterra': 'england',
  'ecosse': 'scotland', 'scozia': 'scotland',
  'pays de galles': 'wales', 'galles': 'wales',
  'irlande': 'ireland', 'irlanda': 'ireland',
  'irlande du nord': 'northern ireland',
  'espagne': 'spain', 'spagna': 'spain',
  'italie': 'italy', 'italia': 'italy',
  'allemagne': 'germany', 'germania': 'germany',
  'france': 'france', 'francia': 'france',
  'portugal': 'portugal', 'portogallo': 'portugal',
  'belgique': 'belgium', 'belgio': 'belgium',
  'pays bas': 'netherlands', 'hollande': 'netherlands', 'olanda': 'netherlands', 'nederland': 'netherlands',
  'suisse': 'switzerland', 'svizzera': 'switzerland',
  'autriche': 'austria', 'austria': 'austria',
  'grece': 'greece', 'grecia': 'greece',
  'turquie': 'turkey', 'turchia': 'turkey',
  'russie': 'russia', 'russia': 'russia',
  'ukraine': 'ukraine',
  'pologne': 'poland', 'polonia': 'poland',
  'republique tcheque': 'czech republic', 'tchequie': 'czech republic', 'repubblica ceca': 'czech republic',
  'croatie': 'croatia', 'croazia': 'croatia',
  'serbie': 'serbia', 'serbia': 'serbia',
  'danemark': 'denmark', 'danimarca': 'denmark',
  'suede': 'sweden', 'svezia': 'sweden',
  'norvege': 'norway', 'norvegia': 'norway',
  'finlande': 'finland', 'finlandia': 'finland',
  'islande': 'iceland', 'islanda': 'iceland',
  'roumanie': 'romania', 'romania': 'romania',
  'hongrie': 'hungary', 'ungheria': 'hungary',
  'bulgarie': 'bulgaria', 'bulgaria': 'bulgaria',
  'slovaquie': 'slovakia', 'slovacchia': 'slovakia',
  'slovenie': 'slovenia', 'slovenia': 'slovenia',
  'lettonie': 'latvia', 'lettonia': 'latvia',
  'lituanie': 'lithuania', 'lituania': 'lithuania',
  'estonie': 'estonia', 'estonia': 'estonia',
  'georgie': 'georgia', 'georgia': 'georgia',
  'armenie': 'armenia',
  'azerbaidjan': 'azerbaijan', 'azerbaigian': 'azerbaijan',
  // Amerique
  'etats unis': 'usa', 'etats-unis': 'usa', 'us': 'usa', 'united states': 'usa',
  'canada': 'canada',
  'mexique': 'mexico', 'messico': 'mexico',
  'bresil': 'brazil', 'brasile': 'brazil',
  'argentine': 'argentina', 'argentina': 'argentina',
  'colombie': 'colombia', 'colombia': 'colombia',
  'chili': 'chile', 'cile': 'chile',
  'uruguay': 'uruguay',
  'perou': 'peru', 'peru': 'peru',
  'equateur': 'ecuador', 'ecuador': 'ecuador',
  'venezuela': 'venezuela',
  'paraguay': 'paraguay',
  'bolivie': 'bolivia', 'bolivia': 'bolivia',
  // Afrique
  'egypte': 'egypt', 'egitto': 'egypt',
  'maroc': 'morocco', 'marocco': 'morocco',
  'algerie': 'algeria', 'algeria': 'algeria',
  'tunisie': 'tunisia', 'tunisia': 'tunisia',
  'senegal': 'senegal',
  'cote d ivoire': 'ivory coast', 'cote divoire': 'ivory coast', 'costa d avorio': 'ivory coast',
  'ghana': 'ghana',
  'nigeria': 'nigeria',
  'cameroun': 'cameroon', 'camerun': 'cameroon',
  'afrique du sud': 'south africa', 'sudafrica': 'south africa',
  'republique democratique du congo': 'dr congo', 'rd congo': 'dr congo',
  'burkina faso': 'burkina faso',
  'mali': 'mali',
  'kenya': 'kenya',
  'zambie': 'zambia', 'zambia': 'zambia',
  'zimbabwe': 'zimbabwe',
  'tanzanie': 'tanzania', 'tanzania': 'tanzania',
  // Asie
  'japon': 'japan', 'giappone': 'japan',
  'coree du sud': 'south korea', 'corea del sud': 'south korea',
  'coree du nord': 'north korea',
  'chine': 'china', 'cina': 'china',
  'inde': 'india', 'india': 'india',
  'indonesie': 'indonesia', 'indonesia': 'indonesia',
  'thailande': 'thailand', 'tailandia': 'thailand',
  'vietnam': 'vietnam',
  'malaisie': 'malaysia', 'malesia': 'malaysia',
  'philippines': 'philippines', 'filippine': 'philippines',
  'iran': 'iran',
  'irak': 'iraq', 'iraq': 'iraq',
  'arabie saoudite': 'saudi arabia', 'arabia saudita': 'saudi arabia',
  'qatar': 'qatar',
  'emirats arabes unis': 'uae', 'emirats': 'uae',
  'israel': 'israel', 'israele': 'israel',
  'liban': 'lebanon', 'libano': 'lebanon',
  'jordanie': 'jordan', 'giordania': 'jordan',
  'syrie': 'syria', 'siria': 'syria',
  'palestine': 'palestine',
  // Oceanie
  'australie': 'australia', 'australia': 'australia',
  'nouvelle zelande': 'new zealand', 'nuova zelanda': 'new zealand',
};

function applyAliases(s) {
  // Chercher la plus longue correspondance d'alias (ex: "pays de galles" avant "galles")
  const keys = Object.keys(TEAM_ALIASES).sort((a, b) => b.length - a.length);
  let out = s;
  for (const k of keys) {
    if (out.includes(k)) out = out.replace(new RegExp(`\\b${k}\\b`, 'g'), TEAM_ALIASES[k]);
  }
  return out;
}

export function norm(s) {
  const base = (s || '').toLowerCase().normalize('NFD').replace(DIACRITICS, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const aliased = applyAliases(base);
  return aliased
    .replace(/\b(fc|cf|sc|ac|afc|cd|ec|sd|fk|as|us|ss|rfc|bsc|vfb|tsv|sv|rc|ogc|ssc|club|deportivo|universidad|u\.|de|del|do|da|et|les|the|al|el)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
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
