// ═══════════════════════════════════════════════════════════════════════════
// BET9JA — CARTOGRAPHIE DES MARCHÉS
//
// Bet9ja ne livre pas des cotes plates : chaque cote est une clé
// `MARKETID@ligne_SIGNE` (ex. `S_OU@2.5_O`, `S_AH@-0.5_1`) et les codes de
// signes sont propres à chaque match (dictionnaire D.MK[].SGNK). Ce module
// traduit ces clés vers le vocabulaire STANDARD du système
// (cf. src/core/markets.js) : lui seul décide quels marchés Bet9ja peuvent
// être comparés aux autres bookmakers.
//
// Couvert — temps réglementaire : 1X2, Double Chance, BTTS, Draw No Bet,
// Totaux (demi-lignes), Handicap asiatique, Pair/Impair, 1re équipe à
// marquer, Mi-temps la plus prolifique, Totaux par équipe.
// Couvert — 1re et 2e mi-temps : 1X2, Double Chance, DNB, BTTS, Totaux.
// Couvert — corners : total, 1re mi-temps, 2e mi-temps, handicap asiatique
// (match, 1re et 2e mi-temps), pair/impair, pair/impair 1re mi-temps.
//
// Volontairement NON mappés (aucun équivalent standard → comparaison fausse) :
// handicaps européens 3-way (S_1X2HND, S_HNDCORNER), corners 1X2 (S_TEAMCORNER),
// combinés (S_1X2OU, S_DCOU, S_HTFT, S_DCGGNG...), marchés à fenêtre de temps
// (« Early », « 5/10/15 minutes »), multi-buts, tirs, cartons, fautes, hors-jeu.
// ═══════════════════════════════════════════════════════════════════════════
import { isHalfLine } from '../../core/markets.js';

// Signes fixes (marchés sans ligne) : MARKETID → { SIGNE: clé standard }
const SIGN_MAP = {
  S_1X2:      { 1: 'match_1', X: 'match_X', 2: 'match_2' },
  S_DC:       { '1X': 'dc_1X', '12': 'dc_12', 'X2': 'dc_X2' },
  S_DNB:      { 1: 'dnb_1', 2: 'dnb_2' },
  S_GGNG:     { Y: 'btts_yes', N: 'btts_no' },
  S_OE:       { OD: 'odd', EV: 'even' },
  S_1STGOAL:  { 1: 'fts_home', X: 'fts_none', 2: 'fts_away' },
  S_HIGHHALF: { 1: 'half_most_ht', E: 'half_most_equal', 2: 'half_most_h2' },
  S_1X21T:    { 1: 'ht_match_1', X: 'ht_match_X', 2: 'ht_match_2' },
  S_DC1T:     { '1X': 'ht_dc_1X', '12': 'ht_dc_12', 'X2': 'ht_dc_X2' },
  S_DNB1T:    { 1: 'ht_dnb_1', 2: 'ht_dnb_2' },
  S_GGNG1T:   { Y: 'ht_btts_yes', N: 'ht_btts_no' },
  S_1X22T:    { 1: 'h2_match_1', X: 'h2_match_X', 2: 'h2_match_2' },
  S_DC2T:     { '1X': 'h2_dc_1X', '12': 'h2_dc_12', 'X2': 'h2_dc_X2' },
  S_DNB2T:    { 1: 'h2_dnb_1', 2: 'h2_dnb_2' },
  S_GGNG2T:   { Y: 'h2_btts_yes', N: 'h2_btts_no' },
  S_OECORNER: { OD: 'cor_odd', EV: 'cor_even' },
  S_OECH:     { O: 'cor_ht_odd', E: 'cor_ht_even' },
};

// Marchés à ligne : (ligne, signe) → clé standard. Le paramètre Bet9ja est
// TOUJOURS vu du domicile : signe 1 = domicile à cette ligne, signe 2 =
// extérieur à la ligne opposée (vérifié sur les cotes réelles).
const LINE_MAP = {
  S_OU:       (l, s) => (s === 'O' ? 'match_over_' + l : s === 'U' ? 'match_under_' + l : null),
  S_OU1T:     (l, s) => (s === 'O' ? 'ht_over_' + l : s === 'U' ? 'ht_under_' + l : null),
  S_OU2T:     (l, s) => (s === 'O' ? 'h2_over_' + l : s === 'U' ? 'h2_under_' + l : null),
  S_OUCORNERS:(l, s) => (s === 'O' ? 'cor_over_' + l : s === 'U' ? 'cor_under_' + l : null),
  S_C1HTOU:   (l, s) => (s === 'O' ? 'cor_ht_over_' + l : s === 'U' ? 'cor_ht_under_' + l : null),
  S_C2HTOU:   (l, s) => (s === 'O' ? 'cor_h2_over_' + l : s === 'U' ? 'cor_h2_under_' + l : null),
  S_AH:       (l, s) => (s === '1' ? 'hcp_home_' + l : s === '2' ? 'hcp_away_' + neg(l) : null),
  S_CAH:      (l, s) => (s === '1' ? 'cor_hcp_home_' + l : s === '2' ? 'cor_hcp_away_' + neg(l) : null),
  S_CAHH:     (l, s) => (s === '1' ? 'cor_ht_hcp_home_' + l : s === '2' ? 'cor_ht_hcp_away_' + neg(l) : null),
  S_CAH2:     (l, s) => (s === '1' ? 'cor_h2_hcp_home_' + l : s === '2' ? 'cor_h2_hcp_away_' + neg(l) : null),
  S_HAOU:     (l, s) => ({ OH: 'tt_home_over_' + l, OA: 'tt_away_over_' + l, UH: 'tt_home_under_' + l, UA: 'tt_away_under_' + l }[s] || null),
};

const fmt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : null;
};
const neg = (l) => fmt(-Number(l));

// Dictionnaire du match : chaque marché déclaré, trié du plus long au plus
// court (certains identifiants sont préfixes d'autres).
function defsOf(D) {
  return (Array.isArray(D && D.MK) ? D.MK : [])
    .filter((m) => m && m.ID)
    .map((m) => ({ sid: String(m.ID), name: m.DS || String(m.ID), category: m.GCAT || '' }))
    .sort((a, b) => b.sid.length - a.sid.length);
}

function defFor(sid, defs) {
  return defs.find((d) => sid === d.sid || sid.startsWith(d.sid + '@') || sid.startsWith(d.sid + '_')) || null;
}

// 'S_OU@2.5_O' → { line: '2.5', sign: 'O' } ; 'S_1X2_1' → { line: null, sign: '1' }
function splitSid(sid, mid) {
  const rest = sid.slice(mid.length);
  if (rest.startsWith('@')) {
    const cut = rest.lastIndexOf('_');
    return { line: cut > 0 ? rest.slice(1, cut) : null, sign: rest.slice(cut + 1) };
  }
  return { line: null, sign: rest.replace(/^_+/, '') };
}

// Traduit UNE clé de cote Bet9ja vers la clé standard (ou null si non couverte).
export function b9KeyOf(sid, def, oddsValue) {
  const v = Number(oddsValue);
  if (!Number.isFinite(v) || v <= 1) return null;
  const { line, sign } = splitSid(sid, def.sid);
  const simple = SIGN_MAP[def.sid];
  if (simple) return simple[sign] || null;
  const lineFn = LINE_MAP[def.sid];
  if (!lineFn) return null;
  if (line == null) return null;
  const l = fmt(line);
  if (!l || !isHalfLine(Number(l))) return null;
  return lineFn(l, sign) || null;
}

// Cotes standard d'un match Bet9ja : { match_1: 1.62, 'match_over_2.5': 1.58, ... }
export function parseB9Odds(D) {
  const defs = defsOf(D);
  const odds = {};
  const used = new Set();
  let ignored = 0;
  for (const [sid, raw] of Object.entries((D && D.O) || {})) {
    const def = defFor(sid, defs);
    const key = def ? b9KeyOf(sid, def, raw) : null;
    if (!key) { ignored++; continue; }
    if (odds[key] == null) odds[key] = Number(raw);
    used.add(def.sid);
  }
  return { odds, mappedMarkets: [...used], ignored };
}

// Rapport de cartographie (sonde) : ce que chaque marché Bet9ja produit.
export function b9MappingReport(D) {
  const defs = defsOf(D);
  const byMarket = new Map(defs.map((d) => [d.sid, { id: d.sid, name: d.name, category: d.category, keys: new Set() }]));
  let ignored = 0;
  for (const [sid, raw] of Object.entries((D && D.O) || {})) {
    const def = defFor(sid, defs);
    if (!def) continue;
    const key = b9KeyOf(sid, def, raw);
    if (key) byMarket.get(def.sid).keys.add(key);
    else ignored++;
  }
  const rows = [...byMarket.values()].map((m) => ({ id: m.id, name: m.name, category: m.category, keys: [...m.keys].sort() }));
  return {
    rows,
    totals: {
      markets: rows.length,
      mapped: rows.filter((r) => r.keys.length).length,
      keys: rows.reduce((n, r) => n + r.keys.length, 0),
      ignoredSelections: ignored,
    },
  };
}
