// Canonicalisation des libellés natifs de marchés (tous bookmakers, FR/EN)
// en une SIGNATURE comparable d'un book à l'autre.
// Signature : metric|entity|type[|line]|scope
// Ex : cards_yellow|match|over|4.5|FT   —   goals|home|over|1.5|1H

export const asc = (s) => String(s == null ? '' : s)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

// ── Métrique mesurée (ordre = priorité, le plus spécifique d'abord) ──
const METRICS = [
  ['cards_yellow', /yellow card|carton jaune|cartons jaunes|jaune/],
  ['cards_red', /red card|carton rouge|rouge/],
  ['cards', /\bcards?\b|\bcartons?\b|booking|reprimand/],
  ['shots_on_target', /shots? on target|shots? on goal|tirs? cadres|tirs au but/],
  ['shots', /\bshots?\b|\btirs?\b|attempts/],
  ['corners', /corner|coup de coin|coups de pied de coin/],
  ['fouls', /\bfouls?\b|\bfautes?\b/],
  ['offsides', /offside|hors[ -]?jeu/],
  ['throwins', /throw[ -]?in|remise en jeu|touche/],
  ['penalty', /penalt/],
  ['substitutions', /substitution|remplacement/],
  ['saves', /\bsaves?\b|\barrets?\b|gardien/],
  ['possession', /possession/],
  ['player_scorer', /to score|marquera|buteur|scorer|marque un but/],
  ['goals', /goal|\bbuts?\b|total|over|under|plus de|moins de|score|resultat|result|winner|vainqueur|chance|handicap|pair|impair|odd|even/],
];

export function detectMetric(text) {
  for (const [name, re] of METRICS) if (re.test(text)) return name;
  return 'other';
}

// ── Portée temporelle ──
export function detectScope(text) {
  const mw = text.match(/(\d{1,2})\s*[-–]\s*(\d{1,3})\s*(?:min|')/)
    || text.match(/minutes? (\d{1,2})\s*[-–]\s*(\d{1,3})/);
  if (mw) return `MIN_${mw[1]}_${mw[2]}`;
  const upto = text.match(/(?:jusqu.a la|jusqu.a|before|first|premieres?|premiere)\s*(\d{1,2})\s*(?:e|eme|st|nd|rd|th)?\s*(?:min|minutes?)/);
  if (upto) return `MIN_0_${upto[1]}`;
  if (/2nd half|second half|2e mi-temps|2eme mi-temps|deuxieme mi-temps|\bsh\b/.test(text)) return '2H';
  if (/1st half|first half|1ere mi-temps|1re mi-temps|premiere mi-temps|mi-temps 1|\bht\b|\b1h\b/.test(text)) return '1H';
  const per = text.match(/(\d)\s*(?:st|nd|rd|th|er|e|eme|ere)?\s*(set|quarter|quart|period|periode|manche)/);
  if (per) return `${per[2].startsWith('set') ? 'SET' : per[2].startsWith('qua') ? 'Q' : 'P'}${per[1]}`;
  if (/extra time|prolongation/.test(text)) return 'ET';
  return 'FT';
}

// ── Entité concernée ──
export function detectEntity(text, { home = '', away = '' } = {}) {
  const h = asc(home), a = asc(away);
  if (h && text.includes(h)) return 'home';
  if (a && text.includes(a)) return 'away';
  if (/\bhome\b|\bteam ?1\b|\bdomicile\b|\b1ere equipe\b|\bequipe 1\b|\bhost\b/.test(text)) return 'home';
  if (/\baway\b|\bteam ?2\b|\bexterieur\b|\bequipe 2\b|\bguest\b|\bvisiteur\b/.test(text)) return 'away';
  if (/\bboth teams?\b|les deux equipes|each team|chaque equipe/.test(text)) return 'both';
  return 'match';
}

// ── Type de pari + ligne ──
const num = (s) => { const m = String(s).match(/-?\d+(?:[.,]\d+)?/); return m ? Number(m[0].replace(',', '.')) : null; };

export function detectType(marketText, selectionTexts) {
  const sels = selectionTexts.map(asc);
  const t = marketText;
  if (/correct score|score exact|exact score|scorecast|resultat exact/.test(t)) return { type: 'exact', line: null };
  if (/outright|winner of the|to qualify|to win the (?:cup|league|title)|vainqueur final/.test(t)) return { type: 'outright', line: null };
  if (/both teams? to score|les deux equipes marquent|\bbtts\b|goal goal/.test(t)) return { type: 'btts', line: null };
  if (/double chance/.test(t)) return { type: 'dc', line: null };
  if (/draw no bet|\bdnb\b|remboursé si nul|rembourse si nul/.test(t)) return { type: 'dnb', line: null };
  if (/handicap|\bhcp\b|spread|ecart/.test(t)) return { type: 'handicap', line: null };
  if (/odd|even|pair|impair/.test(t) || sels.some((s) => /^(odd|even|pair|impair)$/.test(s))) return { type: 'odd_even', line: null };
  if (/over|under|plus de|moins de|\bo\/u\b|total|more than|less than|\bau moins\b/.test(t)
      || sels.some((s) => /^(over|under|plus de|moins de|\+|-)/.test(s))) {
    const line = num(t) ?? num(sels.find((s) => /\d/.test(s)) || '');
    return { type: 'over_under', line };
  }
  if (sels.length === 3 && sels.some((s) => /^(x|draw|nul|match nul)$/.test(s))) return { type: '1x2', line: null };
  if (sels.length === 2 && sels.every((s) => /^(yes|no|oui|non)$/.test(s))) return { type: 'binary', line: null };
  if (sels.length === 2) return { type: 'two_way', line: null };
  if (/multi ?goals|multibuts|goal range|intervalle/.test(t)) return { type: 'range', line: null };
  return { type: 'other', line: null };
}

// Types réellement exploitables en arbitrage (couverture complète d'un événement).
export const EXPLOITABLE_TYPES = new Set(['over_under', 'handicap', 'odd_even', 'binary', 'btts', '1x2', 'dc', 'dnb', 'two_way', 'range']);

export function signature({ marketName, selections, home, away }) {
  const mt = asc(marketName);
  const selTexts = (selections || []).map((s) => s.name || '');
  const { type, line } = detectType(mt, selTexts);
  const metric = detectMetric(mt);
  const scope = detectScope(mt);
  const entity = detectEntity(mt, { home, away });
  const lineTxt = line != null ? `|${line}` : '';
  return {
    sig: `${metric}|${entity}|${type}${lineTxt}|${scope}`,
    family: `${metric}|${entity}|${type}|${scope}`,
    metric, entity, type, line, scope,
    exploitable: EXPLOITABLE_TYPES.has(type) && (selections || []).length >= 2,
  };
}
