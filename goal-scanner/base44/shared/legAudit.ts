// ═══════════════════════════════════════════════════════════════════
// CONTRÔLE UNIVERSEL DE CONFORMITÉ D'UNE JAMBE (tous bookmakers).
//
// POURQUOI : chaque bookmaker est résolu par un identifiant de sélection fourni
// par le scanner (oddId 1win, priceId betPawa, itemId Congobet…). Cet
// identifiant était joué SANS vérifier qu'il désigne bien la jambe affichée.
// Deux incidents réels en sont nés :
//   • 25/08/2026 — « Dom. +0.5 » chez 1win : l'oddId du scanner désignait en
//     réalité l'ÉQUIPE EXTÉRIEURE. betPawa a posé « Ext. -0.5 » : le même camp
//     joué deux fois, donc zéro couverture (perte garantie au lieu du profit).
//   • Marchés « corners » posés sur le marché de BUTS du temps réglementaire,
//     parce que la reconnaissance de marché ignorait la statistique visée.
//
// RÈGLE : on ne mise que si la sélection trouvée chez le bookmaker porte
//   1. la même STATISTIQUE (buts / corners / cartons / fautes…),
//   2. la même PÉRIODE (match entier / mi-temps / quart-temps / set),
//   3. le même CAMP (domicile, extérieur, nul, over/under, oui/non),
//   4. la même LIGNE (0.5, 2.5…).
// Au moindre désaccord CERTAIN, l'opportunité est abandonnée — jamais de pari
// approximatif. Quand une information est illisible, on ne bloque pas (le
// comportement d'origine est conservé).
// ═══════════════════════════════════════════════════════════════════

import { norm, periodOf, selectionLine, wantedOutcome, type Period } from "./onewinMarketMap.ts";
import { sameTeam } from "./teamMatch.ts";

/* ─────────────── 1. Statistique visée ─────────────── */

export type Dimension = "corners" | "cards" | "fouls" | "shots" | "offsides" | "throwins" | "penalties" | "goals";

const DIM_WORDS: Array<[Dimension, RegExp]> = [
  ["corners", /\b(corner|corners|coup de pied de coin)\b/],
  ["cards", /\b(carton|cartons|card|cards|booking|bookings|jaune|rouge|yellow|red)\b/],
  ["fouls", /\b(faute|fautes|foul|fouls)\b/],
  ["shots", /\b(tir|tirs|shot|shots|frappe)\b/],
  ["offsides", /\b(hors-jeu|hors jeu|offside|offsides)\b/],
  ["throwins", /\b(remise en jeu|touche|throw|throw-in)\b/],
  ["penalties", /\b(penalty|penalties|penalti)\b/],
];

/** Statistique sur laquelle porte un libellé de marché (buts par défaut). */
export function dimensionOf(text: unknown): Dimension {
  const n = norm(text);
  for (const [dim, re] of DIM_WORDS) if (re.test(n)) return dim;
  return "goals";
}

/* ─────────────── 2. Période du marché du bookmaker ─────────────── */

/** Période explicitement portée par le nom de marché d'un bookmaker. */
export function marketPeriod(name: unknown): Period | null {
  const n = norm(name);
  if (/\b(1st half|first half|1ere mi-temps|1ere mi temps|premiere mi-temps|mi-temps 1|halftime|half time|ht|1h|1sthalf)\b/.test(n)) return "half1";
  if (/\b(2nd half|second half|2eme mi-temps|2e mi-temps|seconde mi-temps|mi-temps 2|2h|2ndhalf)\b/.test(n)) return "half2";
  const q = n.match(/\b(?:q|quart-temps|quart temps|quarter)\s*([1-4])\b/) || n.match(/\b([1-4])(?:er|eme|e|st|nd|rd|th)? (?:quart|quarter)\b/);
  if (q) return `q${q[1]}` as Period;
  const s = n.match(/\b(?:set|manche)\s*([1-5])\b/) || n.match(/\b([1-5])(?:er|eme|e|st|nd|rd|th)? set\b/);
  if (s) return `set${s[1]}` as Period;
  return null;
}

/* ─────────────── 3. Camp désigné par un libellé de bookmaker ─────────────── */

/**
 * Camp désigné par le libellé de sélection d'un bookmaker, ramené au même
 * vocabulaire que `wantedOutcome` (1 / 2 / x / 1x / x2 / 12 / over / under /
 * yes / no). Renvoie "" quand le libellé ne permit pas de conclure.
 */
/**
 * Camp déduit du NOM D'ÉQUIPE porté par le libellé de sélection.
 *
 * ⚠️ INDISPENSABLE : l'ordre des équipes n'est pas le même d'un bookmaker à
 * l'autre (mesuré chez 1win : « camp 1 » désignait l'équipe qui est à
 * l'EXTÉRIEUR chez 1xBet). Comparer les camps POSITIONNELS refusait donc des
 * jambes parfaitement correctes. Le nom d'équipe, lui, ne dépend d'aucun ordre.
 * Renvoie "" quand aucune équipe n'est reconnue de façon certaine.
 */
export function sideByTeamName(selectionName: unknown, teams?: { home?: string; away?: string }): string {
  const n = norm(selectionName);
  if (!n) return "";
  // Seuil à 3 caractères : des équipes entières s'appellent « Al Ula FC » ou
  // « ND Gorica » — un seuil trop haut ne laissait AUCUN mot exploitable et le
  // contrôle retombait sur le camp positionnel, source de faux refus.
  // ⚠️ CAUSE D'UN CAMP LU À L'ENVERS (17/09/2026, Burundi U20 vs Kenya U20) :
  // les deux équipes partagent le mot « U20 ». La sélection « Nul ou Kenya U20 »
  // citait donc les DEUX équipes selon ce contrôle → lue « 12 » alors que c'est
  // « X2 », et l'opportunité était abandonnée. Tous les suffixes communs sont
  // concernés (U20, Women, FC, United, Femmes…). Un mot présent dans les deux
  // noms ne distingue rien : il est retiré avant toute comparaison.
  const rawWords = (v?: string) => norm(v).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const shared = new Set(rawWords(teams?.home).filter((w) => rawWords(teams?.away).includes(w)));
  const words = (v?: string) => rawWords(v).filter((w) => !shared.has(w));
  // ⚠️ CAUSE DE REFUS FANTÔMES (mesurée le 16/09/2026 sur Atletico San Luis vs
  // Santos Laguna) : la comparaison cherchait le mot n'importe où DANS la chaîne.
  // « San » (de « San Luis ») se retrouvait donc dans « Santos Laguna » : les
  // deux équipes semblaient citées, le libellé était déclaré illisible, et le
  // contrôle retombait sur le numéro positionnel du bookmaker → « camp 1 au lieu
  // de 2 » sur une sélection parfaitement correcte. Tous les noms courts (San,
  // Sao, Los, Rio, Sud…) étaient touchés. On compare donc MOT À MOT.
  const selWords = norm(selectionName).split(/[^a-z0-9]+/).filter(Boolean);
  const wordSeen = (w: string) => selWords.some((s) =>
    s === w || (w.length >= 5 && s.length >= 5 && (s.startsWith(w) || w.startsWith(s))));
  // ⚠️ LES BOOKMAKERS TRADUISENT LES NOMS D'ÉQUIPE (relevé le 17/09/2026) :
  // 1win écrit « Épanouissement » pour « Blooming », « Lokomotiv Tachkent »
  // pour « Lokomotiv Tashkent ». Aucun mot commun → l'équipe n'était pas
  // reconnue et le contrôle refusait des jambes correctes. On complète donc la
  // comparaison mot à mot par l'appariement d'équipes complet (même
  // vocabulaire de traductions et de translittérations que la reconnaissance
  // de match), appliqué à chaque partie du libellé.
  const parts = String(selectionName ?? "").split(/\s*(?:\bou\b|\bor\b|\/|&|,|\+)\s*/i)
    .map((p) => p.trim()).filter((p) => p.length >= 3);
  const hit = (v?: string) => {
    if (!v) return false;
    const ws = words(v);
    if (ws.length && ws.some(wordSeen)) return true;
    return parts.some((p) => sameTeam(p, v));
  };
  const isHome = hit(teams?.home);
  const isAway = hit(teams?.away);
  // ⚠️ CAUSE N°1 DES OPPORTUNITÉS 1win ABANDONNÉES (51 refus en 48 h, tous sur
  // « Un gagnant (12) ») : 1win nomme la double chance sans nul « Équipe A Ou
  // Équipe B ». Les DEUX équipes étant citées, le libellé était déclaré
  // illisible, le contrôle retombait sur le numéro positionnel du bookmaker
  // (« 1 ») et refusait « camp 1 au lieu de 12 » alors que la sélection était
  // la BONNE. Deux équipes reliées par « ou / or », c'est exactement « 12 ».
  // Deux équipes reliées par « ou », c'est « 12 » — sauf si le match nul est
  // aussi cité : « Nul ou <équipe> » n'est jamais un « 12 », et un libellé qui
  // nommerait les deux équipes ET le nul serait incohérent → illisible.
  const drawCited = /\b(nul|draw)\b/.test(n);
  if (isHome && isAway) return !drawCited && /\b(ou|or)\b/.test(n) ? "12" : "";
  if (isHome === isAway) return ""; // aucune → illisible
  if (isHome) return drawCited ? "1x" : "1";
  return drawCited ? "x2" : "2";
}

export function sideOfSelection(
  selectionName: unknown,
  outcome: unknown,
  family: string,
  teams?: { home?: string; away?: string },
): string {
  // ⚠️ MARCHÉS DE TOTAL : le camp est « plus de » / « moins de », JAMAIS un
  // numéro d'équipe. Sur « Total 1 » / « Total 2 » (tennis, tennis de table),
  // 1win sert un camp positionnel (le joueur dont on compte les points) et
  // met le vrai côté dans le LIBELLÉ (« Au-Dessus De 55.5 »). Lire le camp
  // positionnel ici renvoyait « 1 » face à un « over » attendu : la sélection
  // correcte était rejetée et le marché déclaré introuvable.
  const f = norm(family);
  if (/\btotal|over|under|plus de|moins de/.test(f)) {
    const txt = `${norm(selectionName)} ${norm(outcome)}`;
    if (/(plus de|over|dessus)/.test(txt) || /\+\s*\d/.test(txt)) return "over";
    if (/(moins de|under|dessous)/.test(txt) || /-\s*\d/.test(txt)) return "under";
    // Le bookmaker ne dit ni « plus » ni « moins » (Congobet sert un simple
    // « 1 » / « 2 » sur ses totaux). Lire ce numéro comme un CAMP faisait
    // refuser des jambes correctes (« camp 1 au lieu de under »). Sur un marché
    // de total, un numéro positionnel ne prouve RIEN : information illisible.
    return "";
  }

  // ⚠️ PAIR / IMPAIR : le camp est « pair » ou « impair », JAMAIS un numéro
  // d'équipe. 1win nomme la sélection « Parité » et sert un camp positionnel
  // (« 1 ») : lu comme un camp, il donnait « camp 1 au lieu de even » et
  // l'opportunité était abandonnée. Sur ce marché, un numéro ne prouve rien.
  if (/\b(pair|impair|paire|impaire|odd|even|parite)\b/.test(f)) {
    const txt = `${norm(selectionName)} ${norm(outcome)}`;
    if (/\b(impair|impaire|odd)\b/.test(txt)) return "odd";
    if (/\b(pair|paire|even)\b/.test(txt)) return "even";
    return "";
  }

  // ⚠️ DOUBLE CHANCE SANS LE NUL — 52 abandons live relevés (Bunyodkor PFK vs
  // Lokomotiv Tashkent, Blooming vs Universitario…) : les bookmakers nomment ce
  // pari « Équipe A ou Équipe B », et il suffisait qu'UN des deux noms soit
  // traduit (« Épanouissement » pour « Blooming », « Tachkent » pour
  // « Tashkent ») pour qu'une seule équipe soit reconnue → camp lu « 1 » au lieu
  // de « 12 » et opportunité perdue. Sur un marché de double chance, deux camps
  // reliés par « ou » sans mention du nul, c'est « 12 » — quels que soient les
  // noms écrits. Le nul, lui, reste lu par les noms (1X / X2).
  if (/double chance|\b1x2\b|\bdc\b/.test(f)) {
    const sel = norm(selectionName);
    // Uniquement le mot « ou / or » : la barre oblique sert aussi à écrire les
    // paires de double (tennis « Arends/Stevens ») et ne prouve rien.
    const joined = /\b(ou|or)\b/.test(sel);
    if (joined && !/\b(nul|draw)\b/.test(sel)) return "12";
  }

  // Priorité au nom d'équipe : seule information indépendante de l'ordre des
  // équipes choisi par le bookmaker.
  const byTeam = sideByTeamName(selectionName, teams);
  if (byTeam) return byTeam;
  // Vocabulaires « W1 / W2 / WX » (BetConstruct, 1win) ramenés à 1 / 2 / x.
  const clean = (v: unknown) => norm(v).replace(/^w(?=[12x]\b|[12x]$)/, "").replace(/^p(?=[12]$)/, "");
  const direct = clean(outcome);
  const alt = clean(selectionName);
  const known = /^(1|2|x|1x|x2|12|over|under|yes|no)$/;
  let side = known.test(direct)
    ? direct
    : known.test(alt)
      ? alt
      : (wantedOutcome(String(selectionName ?? ""), teams, family) || wantedOutcome(String(outcome ?? ""), teams, family));

  // Un libellé qui mentionne le match nul est forcément une DOUBLE CHANCE : le
  // camp positionnel « 1 » du bookmaker désigne alors « 1X », jamais la victoire
  // sèche. Sans cette lecture, « Nul ou <équipe> » était pris pour « 1 » et
  // l'opportunité refusée à tort.
  if (/\b(nul|draw)\b/.test(norm(selectionName)) && (side === "1" || side === "2")) {
    side = side === "1" ? "1x" : "x2";
  }
  return side;
}

/* ─────────────── 4. Ligne ─────────────── */

/**
 * Ligne visée par la jambe affichée.
 *
 * ⚠️ TROISIÈME CAUSE MAJEURE DE « MARCHÉ INTROUVABLE » : on prenait le PREMIER
 * nombre du libellé. « J2 +56.5 » donnait donc la ligne 2 (le numéro du joueur),
 * comparée à la ligne 56.5 servie par le bookmaker → « ligne 56.5 au lieu de 2 »
 * et abandon d'une jambe parfaitement correcte. Tous les libellés J1/J2, T1/T2,
 * E1/E2 étaient touchés. selectionLine sait distinguer un numéro de camp d'une
 * vraie ligne.
 */
const lineOfLabel = (label: unknown): number | null => {
  const l = selectionLine(label);
  return l === null ? null : Math.abs(l);
};

/* ─────────────── Contrôle complet ─────────────── */

export interface AuditInput {
  book: string;
  family: string;
  legLabel: string;
  marketName?: unknown;
  selectionName?: unknown;
  outcome?: unknown;
  line?: unknown;
  teams?: { home?: string; away?: string };
}

export type AuditVerdict = { ok: true } | { ok: false; code: string; reason: string };

export function auditLeg(a: AuditInput): AuditVerdict {
  const shown = `${a.family} / ${a.legLabel}`;
  const market = String(a.marketName ?? "");
  const sel = String(a.selectionName ?? "");
  const refuse = (code: string, why: string): AuditVerdict => ({
    ok: false, code,
    reason: `${a.book} : ${why} — la jambe affichée est « ${shown} », la sélection trouvée est « ${market} / ${sel} ». Opportunité abandonnée (aucune mise engagée).`,
  });

  const wantDim = dimensionOf(`${a.family} ${a.legLabel}`);
  const wantPeriod = periodOf(a.family) === "games" ? null : periodOf(a.family);

  // 0. NOM DE MARCHÉ MUET SUR UN PARI SPÉCIAL — incident « +1,5 carton jaune »
  //    couvert par « −1,5 BUT » (04/09/2026). Le contrôle de statistique ne
  //    s'appliquait que si le bookmaker nommait son marché ; sans nom, on
  //    misait à l'aveugle et rien n'empêchait de tomber sur les buts du temps
  //    réglementaire. Dès que la jambe affichée porte une statistique autre que
  //    les buts, ou une période précise, le nom de marché du bookmaker devient
  //    OBLIGATOIRE : pas de nom = pas de preuve = pas de mise.
  if (!market && (wantDim !== "goals" || wantPeriod)) {
    return refuse(
      "market_unnamed",
      `le bookmaker ne nomme pas son marché, impossible de prouver qu'il s'agit bien de « ${wantDim}${wantPeriod ? ` / ${wantPeriod}` : ""} »`,
    );
  }

  // 1. Statistique : un pari « corners » ne se pose jamais sur les buts.
  if (market) {
    const gotDim = dimensionOf(market);
    if (wantDim !== gotDim) return refuse("dimension_mismatch", `marché de « ${gotDim} » au lieu de « ${wantDim} »`);
  }

  // 2. Période : un pari de mi-temps ne se pose jamais sur le match entier.
  if (market) {
    const wantP = periodOf(a.family);
    const gotP = marketPeriod(market);
    const wantReal = wantP === "games" ? null : wantP;
    // On ne refuse que sur un DÉSACCORD CERTAIN : le nom de marché du bookmaker
    // porte une période, et ce n'est pas celle demandée. Un nom de marché muet
    // (« 1X2 » dans un groupe déjà filtré sur la mi-temps par le résolveur) ne
    // prouve rien et ne doit pas faire perdre une opportunité valable.
    if (gotP && gotP !== wantReal) {
      return refuse("period_mismatch", `période « ${gotP} » au lieu de « ${wantReal ?? "match entier"} »`);
    }
  }

  // 3. Camp : le contrôle qui empêche de miser deux fois du même côté.
  const wanted = wantedOutcome(a.legLabel, a.teams, a.family);
  if (wanted && (sel || a.outcome)) {
    const got = sideOfSelection(sel, a.outcome, a.family, a.teams);
    if (got && got !== wanted) return refuse("side_mismatch", `camp « ${got} » au lieu de « ${wanted} »`);
  }

  // 4. Ligne (0.5, 2.5…) : même valeur absolue de part et d'autre.
  const wantLine = lineOfLabel(a.legLabel);
  const gotLine = a.line === null || a.line === undefined || a.line === "" ? null : Math.abs(Number(a.line));
  if (wantLine !== null && gotLine !== null && Number.isFinite(gotLine) && Math.abs(gotLine - wantLine) > 0.001) {
    return refuse("line_mismatch", `ligne ${gotLine} au lieu de ${wantLine}`);
  }

  return { ok: true };
}

/** Champs de sélection possibles selon les bookmakers → contrôle unifié. */
export function auditSelection(
  book: string,
  opp: Record<string, any>,
  legLabel: string,
  selection: Record<string, any>,
): AuditVerdict {
  return auditLeg({
    book,
    family: String(opp.market_family || ""),
    legLabel: String(legLabel || ""),
    marketName: selection.market ?? selection.group ?? selection.marketName ?? "",
    selectionName: selection.label ?? selection.name ?? selection.selectionName ?? "",
    outcome: selection.outcome ?? "",
    line: selection.line ?? selection.handicap ?? selection.base ?? selection.sbv ?? selection.v1 ?? null,
    teams: { home: opp.team_home, away: opp.team_away },
  });
}