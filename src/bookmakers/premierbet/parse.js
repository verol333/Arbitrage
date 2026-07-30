// Parseur football PremierBet (API mobile /events/{id} → cotes plates standard).
// L'API mobile ne porte pas d'IDs de marché stables entre pays : on parse par NOM
// (locale=fr) + mots-clés, avec fallback sur la position/nom des outcomes.
import { isHalfLine } from '../../core/markets.js';
import { extractLine } from './api.js';

const rmAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s) => rmAccents(s).toLowerCase().replace(/\s+/g, ' ').trim();

// Préfixe temporel du marché : plein-temps par défaut, sinon ht_/h2_.
function detectPeriodPrefix(name) {
  const n = norm(name);
  // Mi-temps 1
  if (/(1(ere|re| ere)? mi[- ]?temps|premiere mi[- ]?temps|mi[- ]?temps 1|1st half|1mt\b|1e mt|1ere periode|first half)/.test(n)) {
    return { pfx: 'ht_', stripped: n };
  }
  // Mi-temps 2
  if (/(2(eme|nde|de| eme)? mi[- ]?temps|deuxieme mi[- ]?temps|mi[- ]?temps 2|2nd half|2mt\b|2e mt|second half|derniere mi[- ]?temps)/.test(n)) {
    return { pfx: 'h2_', stripped: n };
  }
  return { pfx: '', stripped: n };
}

function isCorners(name) {
  return /(corner|coup(?:s)? de pied de coin|coup[- ]?franc[- ]?coin)/.test(norm(name));
}

// Récupère la cote d'un outcome ("value" ou fallback sur odds/price).
function oddOf(o) {
  const raw = o?.value ?? o?.odds ?? o?.price ?? o?.oddValue;
  const n = Number(raw);
  return Number.isFinite(n) && n > 1 ? n : null;
}

// Identifie l'outcome par son nom normalisé et sa position d'apparition.
function nameMatches(o, patterns) {
  const n = norm(o?.name ?? o?.title ?? o?.label ?? '');
  if (!n) return false;
  return patterns.some((rx) => (rx instanceof RegExp ? rx.test(n) : n === rx));
}

// ─── SLOT WRITERS ──────────────────────────────────────────────────────────────
function put1x2(market, odds, pfx) {
  const outcomes = market.outcomes || [];
  const p0 = /^1$|home|dom/i, pX = /^x$|^n$|nul|draw|equal/i, p2 = /^2$|away|ext|exterieur/i;
  const rec = (key, val) => { if (val) odds[key] = val; };
  outcomes.forEach((o, i) => {
    const v = oddOf(o);
    if (!v) return;
    if (nameMatches(o, [p0])) rec(`${pfx}match_1`, v);
    else if (nameMatches(o, [pX])) rec(`${pfx}match_X`, v);
    else if (nameMatches(o, [p2])) rec(`${pfx}match_2`, v);
    else if (i === 0) rec(`${pfx}match_1`, v);
    else if (i === 1 && outcomes.length === 3) rec(`${pfx}match_X`, v);
    else if (i === 2 || (i === 1 && outcomes.length === 2)) rec(`${pfx}match_2`, v);
  });
}

function putDC(market, odds, pfx) {
  const outcomes = market.outcomes || [];
  outcomes.forEach((o, i) => {
    const v = oddOf(o);
    if (!v) return;
    const n = norm(o.name || '').replace(/\s/g, '');
    if (n === '1x' || n === 'x1' || /(1|dom).*(x|nul)|(x|nul).*(1|dom)/.test(n)) odds[`${pfx}dc_1X`] = v;
    else if (n === '12' || n === '21' || /(1|dom).*(2|ext)|(2|ext).*(1|dom)/.test(n)) odds[`${pfx}dc_12`] = v;
    else if (n === 'x2' || n === '2x' || /(x|nul).*(2|ext)|(2|ext).*(x|nul)/.test(n)) odds[`${pfx}dc_X2`] = v;
    else if (i === 0) odds[`${pfx}dc_1X`] = v;
    else if (i === 1) odds[`${pfx}dc_12`] = v;
    else if (i === 2) odds[`${pfx}dc_X2`] = v;
  });
}

function putBtts(market, odds, pfx) {
  for (const o of (market.outcomes || [])) {
    const v = oddOf(o);
    if (!v) continue;
    const n = norm(o.name || '');
    if (/^(oui|yes|o)$/.test(n) || /marquent|score/.test(n)) odds[`${pfx}btts_yes`] = v;
    else if (/^(non|no|n)$/.test(n) || /pas|neither/.test(n)) odds[`${pfx}btts_no`] = v;
  }
}

// Over/Under générique. La ligne (2.5, 3.5, etc.) est lue PAR OUTCOME parce que
// premierbet met plusieurs lignes dans un seul market : outcomes = ["plus de"=1.63,
// "moins de"=2.09, "plus de"=1.03, "moins de"=8.60, ...] avec la ligne dans
// outcome.baseValue. Lire au niveau market retournait line=null → rien parse.
function putOverUnder(market, odds, slotUnder, slotOver) {
  for (const o of (market.outcomes || [])) {
    const v = oddOf(o);
    if (!v) continue;
    const line = extractLine(market, o);
    if (!isHalfLine(line)) continue;
    const n = norm(o.name || '');
    if (/^(plus|sup|over|\+)/.test(n) || /^plus de/.test(n)) odds[slotOver(line)] = v;
    else if (/^(moins|inf|under|-)/.test(n) || /^moins de/.test(n)) odds[slotUnder(line)] = v;
  }
}

function putTotal(market, odds, pfx) {
  putOverUnder(market, odds,
    (l) => `${pfx}under_${l}`,
    (l) => `${pfx}over_${l}`);
}

function putTeamTotal(market, odds, side, pfx) {
  putOverUnder(market, odds,
    (l) => `${pfx}tt_${side}_under_${l}`,
    (l) => `${pfx}tt_${side}_over_${l}`);
}

// Handicap : ligne PAR OUTCOME (premierbet met plusieurs lignes de handicap
// dans un seul market — ex: "1X2 - Handicap" a 3 lignes = 9 outcomes 1/X/2).
// Supporte 2-way (dom/ext) et 3-way (1/X/2 avec draw remboursé).
function putHandicap(market, odds, pfx) {
  const outcomes = market.outcomes || [];
  for (let i = 0; i < outcomes.length; i++) {
    const o = outcomes[i];
    const v = oddOf(o);
    if (!v) continue;
    const line = extractLine(market, o);
    if (!isHalfLine(line)) continue;
    const n = norm(o.name || '');
    // 3-way : "1", "X", "2" — n est nul si on lit juste le chiffre
    if (/^x$|^n$|nul|draw/.test(n)) continue; // ignore draw en handicap
    const isHome = /^1(\s|\(|\+|-|$|$)/.test(n) || /home|dom/.test(n);
    const isAway = /^2(\s|\(|\+|-|$|$)/.test(n) || /away|ext/.test(n);
    if (isHome) odds[`${pfx}hcp_home_${line}`] = v;
    else if (isAway) odds[`${pfx}hcp_away_${-line}`] = v;
  }
}

function putDnb(market, odds, pfx) {
  const outcomes = market.outcomes || [];
  outcomes.forEach((o, i) => {
    const v = oddOf(o);
    if (!v) return;
    const n = norm(o.name || '');
    if (/^1$|home|dom/.test(n) || i === 0) odds[`${pfx}dnb_1`] = v;
    else if (/^2$|away|ext/.test(n) || i === outcomes.length - 1) odds[`${pfx}dnb_2`] = v;
  });
}

function putOddEven(market, odds, pfx) {
  for (const o of (market.outcomes || [])) {
    const v = oddOf(o);
    if (!v) continue;
    const n = norm(o.name || '');
    if (/^(impair|odd)$/.test(n)) odds[`${pfx}odd`] = v;
    else if (/^(pair|even)$/.test(n)) odds[`${pfx}even`] = v;
  }
}

function putFts(market, odds) {
  const outcomes = market.outcomes || [];
  outcomes.forEach((o, i) => {
    const v = oddOf(o);
    if (!v) return;
    const n = norm(o.name || '');
    if (/^1$|home|dom/.test(n) || i === 0) odds.fts_home = v;
    else if (/^2$|away|ext/.test(n) || (outcomes.length === 3 && i === 2)) odds.fts_away = v;
    else if (/aucun|none|no goal|pas de but|nul/.test(n)) odds.fts_none = v;
  });
}

function putHalfMost(market, odds) {
  for (const o of (market.outcomes || [])) {
    const v = oddOf(o);
    if (!v) continue;
    const n = norm(o.name || '');
    if (/1(ere|re)|premiere|1st|1mt/.test(n)) odds.half_most_ht = v;
    else if (/2(eme|nde)|deuxieme|2nd|2mt/.test(n)) odds.half_most_h2 = v;
    else if (/egal|equal|meme|tie|draw/.test(n)) odds.half_most_equal = v;
  }
}

// ─── ORCHESTRATEUR ─────────────────────────────────────────────────────────────
// Reconnaît la famille de marché par mots-clés dans le nom (locale=fr).
// L'ajout de nouvelles familles se fait ici, sans toucher aux slot-writers.
export function premierbetFlatOdds(markets) {
  const odds = {};
  for (const m of (markets || [])) {
    const rawName = m?.name || m?.title || '';
    if (!rawName) continue;
    const { pfx: period, stripped: n } = detectPeriodPrefix(rawName);
    const corners = isCorners(rawName);
    // Préfixe final utilisé pour ranger les clés dans le schéma commun.
    const cornerPfx = corners ? (period === 'ht_' ? 'cor_ht_' : 'cor_') : period;

    // Famille : 1X2 / DC / BTTS / total / handicap / DNB / odd-even / TT / FTS / half-most
    if (/(1[- ]?x[- ]?2|resultat du match|resultat final|match winner|3-way|vainqueur du match|resultat 3 issues)/.test(n)
        && !/handicap|total|corner|but/.test(n)) {
      put1x2(m, odds, period);
      continue;
    }
    if (/double chance/.test(n) && !corners) { putDC(m, odds, period); continue; }
    if (/(les deux equipes marquent|both teams to score|btts)/.test(n) && !corners) {
      putBtts(m, odds, period); continue;
    }
    if (/(draw no bet|match nul rembours|remboursement match nul|nul rembours|rembours.*match nul|pari rembours)/.test(n) && !corners) {
      putDnb(m, odds, period); continue;
    }
    if (/(pair.*impair|impair.*pair|odd.*even|even.*odd)/.test(n)) {
      putOddEven(m, odds, cornerPfx); continue;
    }
    if (/(1(ere|re)|first|premiere).*(equipe|team).*(marquer|score)/.test(n)) {
      putFts(m, odds); continue;
    }
    if (/(mi[- ]?temps la plus (prolifique|marquante)|highest scoring half|meilleure mi[- ]?temps|mi[- ]?temps avec le plus de buts)/.test(n)) {
      // Ne matche que le marche "quelle mi-temps" — pas les variantes team-specifiques.
      if (!/(equipe|dom|ext|home|away|receveur|visiteur)/.test(n)) {
        putHalfMost(m, odds); continue;
      }
    }
    // Team totals (buts d'une équipe) — accepter avec ou sans mot "buts".
    // Ex : "Total buts equipe a domicile", "Total equipe a domicile", "Buts equipe a domicile"
    if (/(total (des )?buts?|buts?|total).*(dom|home|equipe 1|j1|receveur)/.test(n)
        && !/handicap|nul/.test(n)) {
      putTeamTotal(m, odds, 'home', period); continue;
    }
    if (/(total (des )?buts?|buts?|total).*(ext|away|equipe 2|j2|visiteur)/.test(n)
        && !/handicap|nul/.test(n)) {
      putTeamTotal(m, odds, 'away', period); continue;
    }
    // Handicap (Asiatique ou européen) — testé avant "total" car peut contenir "buts".
    if (/handicap/.test(n)) { putHandicap(m, odds, cornerPfx); continue; }
    // Total buts / corners total / plus ou moins / over-under.
    // Convention markets.js : plein-temps = "match_over_L", 1MT = "ht_over_L",
    // corners = "cor_over_L", corners 1MT = "cor_ht_over_L".
    // Exclure les combos "Resultat + O/U" (parser combo casserait les cotes plates).
    if (/resultat et plus|resultat et moins|resultat.*plus[/ -]?moins/.test(n)) continue;
    const isGoalsTotal = /(total (de )?buts?|nombre (total )?de buts|plus[- ]?ou[- ]?moins|over[/ ]?under|total goals)/.test(n);
    const isCornersTotal = corners && /(total|nombre)/.test(n);
    if (isGoalsTotal || isCornersTotal) {
      const totPfx = corners ? cornerPfx : (period === '' ? 'match_' : period);
      putTotal(m, odds, totPfx);
      continue;
    }
  }
  return odds;
}
