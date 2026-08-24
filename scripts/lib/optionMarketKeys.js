// ═══════════════════════════════════════════════════════════════════
// CANONISATION DES MARCHÉS "À OPTIONS".
//
// Un marché à options = un ensemble FERMÉ d'issues qui ne dépend pas du
// score exact : Oui/Non, tranches de minutes, moment du Nième but,
// Résultat + Total. C'est là qu'on cherche les nouvelles opportunités.
//
// Chaque cote brute est traduite en :
//   set     : identifiant de l'ensemble d'issues (comparable entre books)
//   outcome : l'issue dans cet ensemble
//   size    : nombre d'issues attendu pour que l'ensemble soit couvrable
// Deux books qui décrivent le même marché avec des mots différents
// aboutissent au même `set` — c'est ce qui rend l'appariement possible.
// ═══════════════════════════════════════════════════════════════════

/** minuscules, sans accents, espaces normalisés. */
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function yesNo(t) {
  if (/^(oui|yes|y)$/.test(t)) return 'YES';
  if (/^(non|no|n)$/.test(t)) return 'NO';
  return null;
}

function teamSide(t) {
  if (/(equipe 1|team 1|home|domicile|^1 )/.test(t)) return 'T1';
  if (/(equipe 2|team 2|away|exterieur|^2 )/.test(t)) return 'T2';
  return null;
}

/** Tranche de minutes "16-30" → "16-30" (bornes normalisées). */
function minuteRange(t) {
  const m = t.match(/(\d{1,2})\s*[-–à]\s*(\d{1,3})\s*(?:mins?|minutes?)?/);
  return m ? `${Number(m[1])}-${Number(m[2])}` : null;
}

// ─── Familles reconnues ────────────────────────────────────────────────────
const RULES = [
  // « Équipe 1 va gagner au moins une mi-temps » / « Nul dans au moins une mi-temps »
  {
    id: 'WIN_A_HALF',
    match: (m) => /(gagner|remporter|win).*(au moins une|at least one).*(mi-temps|half)/.test(m)
      || /(nul|draw).*(au moins une|at least one).*(mi-temps|half)/.test(m),
    key: (m) => {
      const who = /nul|draw/.test(m) ? 'DRAW' : teamSide(m) || 'T?';
      return { set: `WIN_A_HALF|${who}`, size: 2 };
    },
    outcome: (s) => yesNo(s),
  },
  // « Moment du deuxième but » : 1-55 / Pas de deuxième but / 56-90
  {
    id: 'GOAL_MOMENT',
    match: (m) => /moment du .*but|time of .*goal/.test(m),
    key: (m) => {
      const n = /premier|1er|first/.test(m) ? 1
        : /deuxieme|2e|second/.test(m) ? 2
        : /troisieme|3e|third/.test(m) ? 3 : 0;
      return { set: `GOAL_MOMENT|N${n}`, size: 3 };
    },
    outcome: (s) => {
      if (/pas de|no .*goal|aucun/.test(s)) return 'NONE';
      const r = minuteRange(s);
      return r ? `MIN_${r}` : null;
    },
  },
  // « But dans l'intervalle de temps » (Oui/Non), par équipe et par tranche
  {
    id: 'GOAL_INTERVAL',
    match: (m) => /but dans l.?intervalle|goal in .*interval|intervalle de temps/.test(m),
    key: (m, s) => {
      const side = teamSide(s) || teamSide(m) || 'ANY';
      const range = minuteRange(s) || minuteRange(m);
      const yes = /- non|: non|\bnon\b/.test(m) ? 'NO' : 'YES';
      return range ? { set: `GOAL_INTERVAL|${side}|${range}`, size: 2, forced: yes } : null;
    },
    outcome: (s, forced) => forced || yesNo(s),
  },
  // « 1, Résultat + Total » : V1 Et TP 1.5 - Oui / - Non
  {
    id: 'RESULT_TOTAL',
    match: (m, s) => /resultat \+ total|result .*total/.test(m) || /(v1|v2|1x|x2|12)\s*et\s*(tp|tm|over|under)/.test(s),
    key: (_m, s) => {
      const res = (s.match(/\b(v1|v2|1x|x2|12|x)\b/) || [])[1];
      const dir = /tp|over|plus/.test(s) ? 'OVER' : /tm|under|moins/.test(s) ? 'UNDER' : null;
      const line = (s.match(/(\d+[.,]\d+|\d+)\s*(?:-|$)/) || [])[1];
      if (!res || !dir || !line) return null;
      return { set: `RESULT_TOTAL|${res.toUpperCase()}|${dir}|${String(line).replace(',', '.')}`, size: 2 };
    },
    outcome: (s) => (/- ?non|\bnon\b/.test(s) ? 'NO' : /- ?oui|\boui\b/.test(s) ? 'YES' : null),
  },
  // Filet générique : tout marché binaire Oui/Non non encore identifié.
  {
    id: 'GENERIC_YESNO',
    match: (_m, s) => yesNo(s) != null,
    key: (m) => ({ set: `YESNO|${m.replace(/[^a-z0-9]+/g, '_').slice(0, 60)}`, size: 2 }),
    outcome: (s) => yesNo(s),
  },
];

/**
 * Traduit une cote brute en clé canonique, ou null si le marché n'est pas
 * un marché "à options" exploitable.
 */
export function canonicalize(row) {
  const m = norm(row.market);
  const s = norm(row.selection);
  for (const rule of RULES) {
    if (!rule.match(m, s)) continue;
    const k = rule.key(m, s);
    if (!k) continue;
    const outcome = rule.outcome(s, k.forced);
    if (!outcome) continue;
    return { family: rule.id, set: k.set, outcome, size: k.size, odds: row.odds };
  }
  return null;
}
