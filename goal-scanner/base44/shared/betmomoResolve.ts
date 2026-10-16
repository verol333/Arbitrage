// ═══════════════════════════════════════════════════════════════════
// Résolution d'une sélection BetMomo : à partir de l'ID de match, de la famille
// de marché et du libellé du scanner, retrouve l'event_id + la cote FRAÎCHE.
// (BetConstruct : game → market[type] → event[type_1, base, price])
//
// ── 28/08/2026 : PRISE EN CHARGE DU DIRECT, TOUS SPORTS ──────────────────
// Relevé sur le flux réel de BetMomo : les noms de marchés ne sont PAS les mêmes
// d'un sport à l'autre. Le football utilise « OverUnder » / « AsianHandicap »,
// mais le basket utilise « MatchTotal » / « MatchHandicap » et le tennis
// « SetOverUnder » / « SetHandicap » / « SetPlayer1TotalGames ». Ne connaître que
// les noms du football faisait refuser des opportunités POURTANT DISPONIBLES
// (mesuré : « Total Points Match 156.5 » existait bien chez BetMomo sous
// MatchTotal Over@156.5, et était refusé « marché indisponible »).
//
// ── SÉCURITÉ : LA PORTÉE DU PARI EST EXIGÉE À L'IDENTIQUE ────────────────
// Un pari sur un quart-temps, un set ou une mi-temps ne doit JAMAIS être posé
// sur le marché du match complet. Avant, « Q2 Vainqueur » n'était pas reconnu
// comme un quart-temps et retombait sur le vainqueur du MATCH ENTIER : un pari
// totalement différent de celui annoncé. Toute portée qu'on ne sait pas
// retrouver exactement fait maintenant refuser la sélection.
// ═══════════════════════════════════════════════════════════════════

import { swarmCall } from "./betmomoBetting.ts";

export type BetmomoResolve =
  | { ok: true; selection: { eventId: number; price: number; label: string } }
  | { ok: false; code: string; reason: string };

/**
 * Normalise un libellé du scanner : les signes « − » (moins typographique) et
 * « – » ne sont pas le tiret ASCII, et sans ça « −2.5 » n'était reconnu ni comme
 * un « moins de », ni comme une ligne chiffrée.
 */
function norm(label: string): string {
  return String(label || "").replace(/[\u2212\u2013\u2014]/g, "-").replace(",", ".").trim();
}

/**
 * Retire le désignant de joueur / d'équipe avant de lire un chiffre.
 * « J2 -1.5 » : le « 2 » de « J2 » était lu comme la ligne du handicap, et la
 * sélection n'était donc jamais retrouvée (mesuré sur le tennis en direct).
 */
function stripActor(label: string): string {
  return norm(label).replace(/\b(?:joueur|player|team|[ée]quipe|j|p|t)\s*\.?\s*[12]\b/gi, " ").trim();
}

/** Extrait la ligne (2.5, 0.5…) d'un libellé de total/handicap. */
function readLine(label: string): number | null {
  const m = stripActor(label).match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** Ligne SIGNÉE d'un handicap (« Dom. -4.5 » → -4.5, « Ext. +3.5 » → 3.5). */
function readSignedLine(label: string): number | null {
  const m = stripActor(label).match(/([+-]?)\s*(\d+(\.\d+)?)/);
  if (!m) return null;
  return (m[1] === "-" ? -1 : 1) * Number(m[2]);
}

/**
 * PORTÉE du pari, lue sur la famille + le libellé du scanner :
 *   match       = temps réglementaire complet
 *   half n      = mi-temps n
 *   set n       = set n (tennis, tennis de table, volley)
 *   quarter n   = quart-temps / période n (basket, hockey)
 *   unknown     = portée détectée mais non exploitable → refus
 */
type Scope = { kind: "match" | "half" | "set" | "quarter"; n: number };

function readScope(text: string): Scope {
  const t = norm(text).toLowerCase();
  // Set : « 1er Set », « Set 2 », « 3e set »
  const set = t.match(/(\d)\s*(?:er|e|ème|eme)?\s*set|set\s*(?:n[°o]?\s*)?(\d)/);
  if (set) return { kind: "set", n: Number(set[1] || set[2]) };
  // Quart-temps / période : « Q1 », « Q3 Total », « 2e période », « P2 »
  const q = t.match(/\bq\s*([1-4])\b|(\d)\s*(?:er|e|ème|eme)?\s*(?:quart|p[ée]riode)/);
  if (q) return { kind: "quarter", n: Number(q[1] || q[2]) };
  // Mi-temps
  if (/\b1mt\b|1[eè]re?\s*mi|1st\s*half|premi[eè]re\s*mi|\bht\b|\b1h\b/.test(t)) return { kind: "half", n: 1 };
  if (/\b2mt\b|2[eè]me?\s*mi|2nd\s*half|seconde\s*mi|\b2h\b/.test(t)) return { kind: "half", n: 2 };
  return { kind: "match", n: 0 };
}

type Family = "1X2" | "DC" | "TOTAL" | "BTTS" | "HANDICAP" | null;

function readFamily(family: string, label: string): Family {
  const t = `${family} ${norm(label)}`.toLowerCase();
  if (/handicap/.test(t)) return "HANDICAP";
  // « Un gagnant » (1 ou 2) est une double chance, même si la famille dit 1X2.
  // ⚠️ La double chance est reconnue AVANT le total : « Domicile ou Nul » contient
  // le mot « ou » et était classé comme un total (donc jamais retrouvé).
  if (/double\s*chance|^\s*(1x|12|x2)\s*$/.test(t) || /un gagnant|sans nul|pas de nul/.test(t)) return "DC";
  if (/dom\w*\s*ou\s*nul|nul\s*ou\s*(ext|dom)|1\s*ou\s*x|x\s*ou\s*2|1\s*ou\s*2/.test(t)) return "DC";
  if (/total|over|under|plus de|moins de|\bou\b/.test(t)) return "TOTAL";
  if (/btts|deux .*marquent|both/.test(t)) return "BTTS";
  if (/1x2|r[ée]sultat|winner|vainqueur/.test(t)) return "1X2";
  return null;
}

/**
 * Types de marché EXACTS de BetMomo, relevés sur le flux réel — football,
 * basket, tennis, tennis de table. Rien d'approximatif : un type inconnu
 * renvoie null et le pari est refusé, plutôt que d'être posé au mauvais endroit.
 *
 *   MATCH COMPLET
 *     1X2 ......... P1XP2 (football) · P1P2 (sports sans nul)
 *     DC .......... 1X12X2
 *     TOTAL ....... OverUnder (buts) · MatchTotal (points)
 *     TOTAL équipe  Team1OverUnder / Team2OverUnder
 *                   MatchHomeTeamTotal2 / MatchAwayTeamTotal2 (points)
 *     BTTS ........ BothTeamsToScore
 *     HANDICAP .... AsianHandicap (buts) · MatchHandicap (points)
 *   1RE MI-TEMPS
 *     HalfTimeResult · HalfTimeDoubleChance · HalfTimeOverUnder
 *     HalfTimeTeam1OverUnder / HalfTimeTeam2OverUnder
 *     HalfTimeAsianHandicap · FirstHalfHandicap · HalfHandicap
 *   PAR SET (tennis, tennis de table)
 *     SetWinner · SetOverUnder (total de jeux) · SetHandicap
 *     SetPlayer1TotalGames / SetPlayer2TotalGames
 */
function marketTypeFor(fam: Exclude<Family, null>, scope: Scope, team: 1 | 2 | null): RegExp | null {
  if (scope.kind === "quarter") {
    // Relevé sur le flux basket : QuarterTotal / QuarterHandicap portent bien le
    // numéro du quart-temps dans leur nom (« Quart-temps No.2 - … »), vérifié par
    // scopeMatches. Le VAINQUEUR d'un quart-temps n'a pas de type confirmé : on
    // le refuse plutôt que de risquer le vainqueur du match entier.
    if (fam === "TOTAL" && !team) return /^QuarterTotal$/i;
    if (fam === "HANDICAP") return /^QuarterHandicap$/i;
    return null;
  }

  if (scope.kind === "set") {
    if (fam === "TOTAL") {
      if (team === 1) return /^SetPlayer1TotalGames$/i;
      if (team === 2) return /^SetPlayer2TotalGames$/i;
      return /^SetOverUnder$/i;
    }
    if (fam === "1X2") return /^SetWinner$/i;
    if (fam === "HANDICAP") return /^SetHandicap$/i;
    return null; // pas de double chance ni de BTTS sur un set
  }

  if (fam === "TOTAL" && team) {
    if (scope.kind === "match") {
      return team === 1
        // HomeTeamTotal / AwayTeamTotal = hockey, temps réglementaire (relevé en
        // direct le 01/10/2026). Les variantes « IncludingOvertime » restent exclues.
        ? /^(Team1OverUnder|MatchHomeTeamTotal2|HomeTeamTotal)$/i
        : /^(Team2OverUnder|MatchAwayTeamTotal2|AwayTeamTotal)$/i;
    }
    if (scope.kind === "half" && scope.n === 1) {
      return team === 1
        ? /^(HalfTimeTeam1OverUnder|HalfHomeTeamTotal2)$/i
        : /^(HalfTimeTeam2OverUnder|HalfAwayTeamTotal2)$/i;
    }
    return null;
  }

  if (scope.kind === "match") {
    return {
      "1X2": /^(P1XP2|P1P2)$/i,
      DC: /^1X12X2$/i,
      TOTAL: /^(OverUnder|MatchTotal)$/i,
      BTTS: /^BothTeamsToScore$/i,
      HANDICAP: /^(AsianHandicap|MatchHandicap)$/i,
    }[fam];
  }

  if (scope.kind === "half" && scope.n === 1) {
    return {
      "1X2": /^HalfTimeResult$/i,
      DC: /^HalfTimeDoubleChance$/i,
      TOTAL: /^(HalfTimeOverUnder|HalfTotal)$/i,
      BTTS: null,
      HANDICAP: /^(HalfTimeAsianHandicap|FirstHalfHandicap|HalfHandicap)$/i,
    }[fam];
  }

  return null; // 2e mi-temps : pas de type confirmé sur le flux → on ne parie pas
}

/**
 * Le marché trouvé porte-t-il bien sur la portée demandée ?
 * Les types « Set… » et « Half… » sont partagés par TOUS les sets / toutes les
 * mi-temps : c'est le NOM qui porte le numéro (« Set No.1 : Handicap »,
 * « Mi-temps No.1 - Total de points »). Sans ce contrôle, un pari sur le 1er set
 * pouvait être posé sur le 3e.
 */
function scopeMatches(market: Record<string, any>, scope: Scope): boolean {
  const name = String(market.name || "").toLowerCase();
  const type = String(market.type || "").toLowerCase();

  // « set » seulement, jamais « jeu » : les marchés « Set No.1 - Jeu No.8 »
  // portent sur UN jeu précis, pas sur le set.
  if (scope.kind === "set") return new RegExp(`set\\s*(n[°o]?\\.?\\s*)?${scope.n}\\b`).test(name);

  if (scope.kind === "quarter") return new RegExp(`(quart[-\\s]?temps|p[ée]riode)\\s*(n[°o]?\\.?\\s*)?${scope.n}\\b`).test(name);

  if (scope.kind === "half") {
    // Un marché de mi-temps annonce toujours sa mi-temps dans son nom ou son type.
    if (/mi-temps\s*(n[°o]?\.?\s*)?2|2(nd|e|ème)\s*(mi|half)/.test(name)) return scope.n === 2;
    return /halftime|halfhandicap|firsthalf|1sthalf/.test(type)
      || /mi-temps|1re\s*mi|1st\s*half/.test(name);
  }

  // MATCH COMPLET : on refuse tout marché qui porte en réalité sur un set, une
  // mi-temps ou un quart-temps — c'était la faille du « Q2 Vainqueur ».
  return !/set\s*n|mi-temps|half|quart|p[ée]riode|\bq[1-4]\b/.test(`${name} ${type}`);
}

/** Le pari porte-t-il sur le total d'UNE équipe / UN joueur (Team 1 / Team 2) ? */
function readTeam(text: string, teams: { home?: string; away?: string }): 1 | 2 | null {
  const t = text.toLowerCase();
  const home = (teams.home || "").toLowerCase();
  const away = (teams.away || "").toLowerCase();
  if (/\bdom\b|domicile|\bhome\b|team\s*1|\b(joueur|player|j|p)\s*\.?\s*1\b|\b\(?1\)?\s*total/.test(t) || (home && t.includes(home))) return 1;
  if (/\bext\b|ext[eé]rieur|\baway\b|team\s*2|\b(joueur|player|j|p)\s*\.?\s*2\b/.test(t)) return 2;
  if (away && t.includes(away)) return 2;
  return null;
}

/** Côté attendu (type_1 BetConstruct) déduit du libellé du scanner. */
function expectedSide(fam: Exclude<Family, null>, label: string, teams: { home?: string; away?: string }): RegExp | null {
  const l = norm(label).toLowerCase();
  const home = (teams.home || "").toLowerCase();
  const away = (teams.away || "").toLowerCase();

  // Double chance reconnue AVANT tout : le libellé « Dom. ou Nul » cite DEUX
  // issues, il ne doit jamais être lu comme une victoire sèche même quand la
  // famille annoncée par le scanner est « 1X2 ».
  const dcHome = home && new RegExp(`(${home}).{0,6}(nul|draw)|(nul|draw).{0,6}(${home})`, "i").test(l);
  const dcAway = away && new RegExp(`(${away}).{0,6}(nul|draw)|(nul|draw).{0,6}(${away})`, "i").test(l);
  if (/\b1x\b|1 ou x|dom.*\bnul\b|\bnul\b.*dom/.test(l) || dcHome) return /^W?1X$/i;
  if (/\bx2\b|x ou 2|\bnul\b.*ext|ext.*\bnul\b/.test(l) || dcAway) return /^W?X2$/i;

  if (fam === "1X2" || fam === "HANDICAP") {
    // « Joueur 1 » / « J1 » / « P1 » : libellés des sports à 2 issues (tennis…).
    // BetMomo nomme les côtés de handicap « Home »/« Away » et les vainqueurs
    // « W1 »/« W2 » — les deux sont acceptés.
    if (/^(1|home|dom)/.test(l) || /\b(joueur|player|j|p)\s*\.?\s*1\b/.test(l) || (home && l.includes(home))) return /^(W1|Home)$/i;
    if (/^(2|away|ext)/.test(l) || /\b(joueur|player|j|p)\s*\.?\s*2\b/.test(l) || (away && l.includes(away))) return /^(W2|Away)$/i;
    if (/^(x|nul|draw)/.test(l)) return /^X$/i;
    return null;
  }
  if (fam === "DC") {
    // BetMomo écrit indifféremment « W1X » ou « 1X » selon les marchés.
    if (/1x|1 ou x|dom.*nul/.test(l)) return /^W?1X$/i;
    if (/x2|x ou 2|nul.*ext/.test(l)) return /^W?X2$/i;
    // « Un gagnant » / « sans nul » = 1 ou 2 (pas de match nul).
    if (/12|1 ou 2|un gagnant|sans nul|pas de nul/.test(l)) return /^W?12$/i;
    return null;
  }
  if (fam === "TOTAL") {
    if (/over|plus de|\+/.test(l)) return /^Over$/i;
    if (/under|moins de|-/.test(l)) return /^Under$/i;
    return null;
  }
  // BTTS
  if (/oui|yes/.test(l)) return /^Yes$/i;
  if (/non|no/.test(l)) return /^No$/i;
  return null;
}

/** Retrouve la sélection BetMomo correspondant au pari du scanner. */
export async function resolveBetmomoSelection(
  gameId: string | number,
  marketFamily: string,
  label: string,
  teams: { home?: string; away?: string } = {},
): Promise<BetmomoResolve> {
  const fam = readFamily(marketFamily, label);
  if (!fam) return { ok: false, code: "market_unsupported", reason: `BetMomo : marché « ${marketFamily} » non pris en charge` };

  const side = expectedSide(fam, label, teams);
  if (!side) return { ok: false, code: "side_unknown", reason: `BetMomo : sélection « ${label} » non reconnue` };

  // La portée (match, mi-temps, set, quart-temps) est lue AVANT tout appel
  // réseau : inutile d'interroger BetMomo pour un pari qu'on refusera.
  const scope = readScope(`${marketFamily} ${label}`);
  const wantedTeam = fam === "TOTAL" ? readTeam(`${marketFamily} ${label}`, teams) : null;
  const typeRe = marketTypeFor(fam, scope, wantedTeam);
  if (!typeRe) {
    return {
      ok: false, code: "market_unsupported",
      reason: `BetMomo : marché « ${marketFamily} / ${label} » non pris en charge (portée ${scope.kind}${scope.n || ""}) — aucune mise`,
    };
  }

  const r = await swarmCall(null, [{
    command: "get",
    params: {
      source: "betting",
      what: {
        game: ["id"],
        market: ["id", "name", "type"],
        event: ["id", "price", "name", "type_1", "base"],
      },
      where: { game: { id: Number(gameId) } },
      subscribe: false,
    },
  }]);
  if (!r.success) return { ok: false, code: "feed_unreachable", reason: `BetMomo injoignable (${r.error})` };

  const games = r.responses[0]?.data?.data?.game;
  const game = games ? Object.values(games)[0] as Record<string, any> : null;
  if (!game) return { ok: false, code: "match_not_found", reason: "BetMomo : match introuvable ou déjà terminé" };

  const wantedLine = fam === "TOTAL" ? readLine(label) : fam === "HANDICAP" ? readSignedLine(label) : null;

  for (const market of Object.values(game.market || {}) as Record<string, any>[]) {
    if (!typeRe.test(String(market.type || ""))) continue;
    if (!scopeMatches(market, scope)) continue;
    for (const event of Object.values(market.event || {}) as Record<string, any>[]) {
      if (!side.test(String(event.type_1 || ""))) continue;
      if (wantedLine !== null && Number(event.base) !== wantedLine) continue;
      const price = Number(event.price);
      if (!Number.isFinite(price) || price <= 1) continue;
      return { ok: true, selection: { eventId: Number(event.id), price, label: String(event.name || label) } };
    }
  }

  // BASE FACTUELLE DU REFUS : on nomme ce que BetMomo a RÉELLEMENT servi. Dire
  // « indisponible ou suspendu » sans preuve empêchait de distinguer un marché
  // vraiment retiré d'un type de marché que nous ne savons pas lire.
  const served = Object.values(game.market || {}) as Record<string, any>[];
  const sameType = served.filter((m) => typeRe.test(String(m.type || "")));
  const linesSeen = sameType.flatMap((m) => Object.values(m.event || {}) as Record<string, any>[])
    .map((e) => `${e.type_1}${e.base != null ? ` ${e.base}` : ""}`).slice(0, 8);
  return {
    ok: false, code: "market_unavailable",
    reason: sameType.length
      ? `BetMomo : marché « ${marketFamily} / ${label} » présent mais sans cette sélection (proposé à l'instant : ${linesSeen.join(", ") || "aucune cote ouverte"})`
      : `BetMomo : marché « ${marketFamily} / ${label} » absent du match (${served.length} marchés ouverts, aucun du type attendu)`,
  };
}