// ═══════════════════════════════════════════════════════════════════
// Accès au flux du bookmaker pour les matchs du jour (foot / basket /
// tennis) : liste des compétitions, matchs à venir, cotes des marchés
// FIABLES, et scores en direct (qui servent à vérifier les prédictions).
//
// ⚠️ On ne lit QUE les marchés dont l'identification est certaine et dont
// le résultat est déductible du score (1X2, double chance, totaux, BTTS,
// totaux par mi-temps, handicap). Les marchés exotiques (corners, cartons,
// tirs) ne sont pas exposés avec leur nom par le bookmaker : les deviner
// produit de fausses prédictions, donc ils sont volontairement exclus.
// ═══════════════════════════════════════════════════════════════════

import { relayGet } from "./megapariNet.ts";

const BASE = "https://megapari.africa";
const COUNTRY = 93;
const WORKERS = [

  "https://hidden-pine-7436.veolalex3.workers.dev",
  "https://billowing-sea-2d8e.alvecapital60.workers.dev",
];
const HEADERS: Record<string, string> = {
  accept: "application/json, text/plain, */*",
  "accept-language": "fr-FR,fr;q=0.9",
  "content-type": "application/json",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  "x-requested-with": "XMLHttpRequest",
  "x-app-n": "__BETTING_APP__",
  "x-svc-source": "__BETTING_APP__",
  origin: BASE,
  referer: `${BASE}/fr/line`,
};

export const SPORT_IDS: Record<string, number> = { football: 1, basketball: 3, tennis: 4 };

// Réutilisés par bookCoupon.ts (génération de code coupon).
export const BOOK_BASE = BASE;
export const BOOK_HEADERS = HEADERS;
export const BOOK_WORKERS = WORKERS;

// Compétitions / équipes à ignorer : paris spéciaux, e-sport, formats non réels.
const EXCLUDE = [
  "virtual", "esport", "cyber", "simulation", "special", "spécia", "statistic",
  "équipe vs joueur", "equipe vs joueur", "team vs player", "vs player", "player vs",
  "futsal", "beach", "paris spéciaux", "paris speciaux", "outright", "vainqueur",
  // Formats "alternatifs" : jeunes, réserves, féminines, amateurs, amicaux.
  "u15", "u16", "u17", "u18", "u19", "u20", "u21", "u22", "u23", "youth", "jeune", "junior",
  "reserve", "réserve", "academy", "académie", "women", "féminin", "feminin", "femme", "dames",
  "ladies", "amateur", "friendly", "amical", "amicaux", "indoor", " ii", "(w)", "(f)",
  // Marchés « alternatifs » : ce ne sont pas de vraies affiches.
  "alternatif", "alternative", "espoir", "doubles", "double ",
];

// Divisions mineures / régionales : le nom du pays ne doit pas suffire à les
// faire passer pour un championnat majeur.
const MINOR_LEAGUES = [
  "isthmian", "northern league", "southern league", "national league", "regional",
  "régional", "division 3", "division 4", "division 5", "3e division", "3ème division",
  "3. liga", "4. liga", "oberliga", "regionalliga", "landesliga", "county",
  "district", "tercera", "primera c", "primera d", "serie d", "eccellenza",
  "npl ", "premier division north",
];

// Seuil de popularité : en-dessous, la compétition n'est pas un "top match".
// Le football propose des centaines de compétitions par jour, on ne garde donc
// que les grandes. Le basket et le tennis en comptent bien moins : ce même
// seuil ne laissait passer que la NBA / l'Euroligue — donc AUCUN match hors
// saison, et des journées entières sans le moindre pronostic. Ces deux sports
// prennent donc tout le programme réel (les divisions mineures restent exclues).
const MIN_POPULARITY: Record<string, number> = { football: 45, basketball: 5, tennis: 5 };

// Notation des compétitions : source unique, PAR SPORT (shared/leaguePopularity.ts).
// Le basket et le tennis n'avaient aucune grille propre : Turquie TBL, matchs
// amicaux, MLBL russe et qualifications WTA recevaient tous la même note que
// l'Euroligue ou un tableau final ATP.
import { leaguePopularity as scoreLeague } from "./leaguePopularity.ts";
import { STAT_FAMILY_CODES } from "./settleMarket.ts";

export function leaguePopularity(name: string, sport = "football") {
  const low = String(name || "").toLowerCase();
  if (MINOR_LEAGUES.some((k) => low.includes(k))) return 0;
  return scoreLeague(name, sport);
}

function isExcluded(text: string) {
  const low = String(text || "").toLowerCase();
  return EXCLUDE.some((x) => low.includes(x));
}

// Un nom de joueur (tennis mis à part) trahit un marché "équipe vs joueur".
function looksLikePlayer(s: string) {
  if (!s) return true;
  if (s.includes("/")) return true;
  return false;
}

// Une vraie affiche : deux noms d'équipes plausibles (pas un marché spécial,
// pas un intitulé statistique, pas un nom tronqué).
// Intitulés génériques des marchés spéciaux : « à domicile », « à l'extérieur »,
// « oui / non », « pair / impair »… Ce ne sont jamais des équipes.
const FAKE_SIDES = [
  "domicile", "extérieur", "exterieur", "home team", "away team", "oui", "non",
  "pair", "impair", "équipe 1", "equipe 1", "équipe 2", "equipe 2",
  "n'importe", "autre", "aucun", "vainqueur",
];

function isRealTeamName(s: string) {
  const name = String(s || "").trim();
  if (name.length < 3) return false;
  if (!/[a-zA-ZÀ-ÿ]{3}/.test(name)) return false;
  if (/[+%]|\bou\b|\bet\b|\btotal\b|\bstat/i.test(name)) return false;
  const low = name.toLowerCase();
  if (FAKE_SIDES.some((k) => low.includes(k))) return false;
  return true;
}

export async function bookGet(path: string) {
  // Direct → relais Deno (gratuit) → Cloudflare en dernier : économise le quota quotidien Cloudflare
  const url = `${BASE}${path}`;
  try {
    const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (r.ok) return await r.json();
  } catch { /* relais */ }
  const viaRelay = await relayGet(url, HEADERS);
  if (viaRelay) return viaRelay;
  for (const w of WORKERS) {
    try {
      const r = await fetch(`${w}/?url=${encodeURIComponent(url)}`, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
      if (r.ok) return await r.json();
    } catch { /* worker suivant */ }
  }
  return null;
}

// ── Compétitions d'un sport, triées par popularité ────────────────────
export async function listChamps(sport: string) {
  const sportId = SPORT_IDS[sport];
  const data = await bookGet(`/service-api/LineFeed/GetChampsZip?sport=${sportId}&lng=fr&country=${COUNTRY}`);
  const rows = data?.Value || [];
  return rows
    .filter((i: any) => (i?.LI || i?.CI) && !isExcluded(i.L || ""))
    .map((i: any) => ({ id: i.LI || i.CI, name: i.L || "Inconnu", popularity: leaguePopularity(i.L || "", sport) }))
    .filter((c: any) => c.popularity >= (MIN_POPULARITY[sport] ?? 45))
    .sort((a: any, b: any) => b.popularity - a.popularity);
}

// ── Matchs à venir d'une compétition pour un jour donné (YYYY-MM-DD) ──
export async function listMatches(sport: string, champId: number, dayDate: string) {
  const sportId = SPORT_IDS[sport];
  const data = await bookGet(
    `/service-api/LineFeed/Get1x2_VZip?sports=${sportId}&champs=${champId}&count=200&lng=fr&mode=2&country=${COUNTRY}`,
  );
  const out: any[] = [];
  for (const m of data?.Value || []) {
    if (!m?.I || !m?.S || !m?.O1 || !m?.O2) continue;
    const dt = new Date(m.S * 1000);
    if (dt.toISOString().slice(0, 10) !== dayDate) continue;
    if (dt.getTime() <= Date.now()) continue;
    if (isExcluded(m.O1) || isExcluded(m.O2)) continue;
    if (sport !== "tennis" && (looksLikePlayer(m.O1) || looksLikePlayer(m.O2))) continue;
    // Tennis : « / » = double, on ne garde que les simples.
    if (sport === "tennis" && (String(m.O1).includes("/") || String(m.O2).includes("/"))) continue;
    if (!isRealTeamName(m.O1) || !isRealTeamName(m.O2)) continue;
    out.push({
      match_id: m.I,
      champ_id: champId,
      team_home: String(m.O1).trim(),
      team_away: String(m.O2).trim(),
      // Identifiants d'équipe du bookmaker : c'est eux qui permettront de
      // retrouver le résultat officiel sans risque d'homonymie.
      team_home_id: Number(m.O1I) || 0,
      team_away_id: Number(m.O2I) || 0,
      kickoff_ts: m.S,
      kickoff_iso: dt.toISOString(),
    });
  }
  return out;
}

// ── Cotes des marchés fiables d'un match ──────────────────────────────
// Codes de marché produits (tous vérifiables depuis le score) :
//   WIN_HOME / WIN_DRAW / WIN_AWAY
//   DC_1X / DC_12 / DC_X2
//   OU_OVER_<ligne> / OU_UNDER_<ligne>          (match complet)
//   H1_OVER_<ligne> / H1_UNDER_<ligne>          (1re mi-temps)
//   H2_OVER_<ligne> / H2_UNDER_<ligne>          (2e mi-temps)
//   BTTS_YES / BTTS_NO
//   AH_HOME_<ligne> / AH_AWAY_<ligne>           (handicap asiatique)
// Sous-jeux statistiques exploitables : le bookmaker les NOMME (champ TG) et
// publie leur score final dans ses résultats sous le même intitulé, donc la
// prédiction est vérifiable au chiffre près.
// ⚠️ « Cartons » (en points) est volontairement absent ; « Cartons jaunes »
// est un vrai compte (ex. 1:1) et se vérifie.
export const STAT_FAMILIES: Array<[RegExp, string]> = [
  [/^corners$/i, "CORNERS"],
  // « Cartons jaunes » (compte de cartons, ex. 1:1) — distinct du sous-jeu
  // « Cartons » en points, qui reste écarté.
  [/^cartons jaunes$/i, "YELLOW_CARDS"],
  [/^tirs cadr[ée]s$/i, "SHOTS_ON"],
  [/^tirs vers le but$/i, "SHOTS"],
  [/^fautes$/i, "FOULS"],
  [/^d[ée]gagements de but$/i, "GOALKICKS"],
  [/^hors-jeu$/i, "OFFSIDES"],
  [/^touches$/i, "THROWINS"],
];

export const STAT_LABELS: Record<string, string> = {
  CORNERS: "corners",
  YELLOW_CARDS: "cartons jaunes",
  SHOTS_ON: "tirs cadrés",
  SHOTS: "tirs vers le but",
  FOULS: "fautes",
  GOALKICKS: "dégagements de but",
  OFFSIDES: "hors-jeu",
  THROWINS: "touches",
};

function gamePath(id: number, subGames: boolean) {
  return `/service-api/LineFeed/GetGameZip?id=${id}&lng=fr&isSubGames=${subGames}&GroupEvents=true&countevents=600&grMode=4&country=${COUNTRY}&marketType=1&isNewBuilder=true`;
}

// Lecture des cotes d'un jeu (match principal ou sous-jeu statistique).
// `prefix` préfixe les codes produits, `totalPre` distingue les totaux de buts
// (OU_) des totaux statistiques. `gameId` est mémorisé pour le code coupon.
function collectOdds(
  groups: any[],
  gameId: number,
  prefix: string,
  totalPre: string,
  statOnly: boolean,
  odds: Record<string, number>,
  meta: Record<string, { t: number; p: number; g: number }>,
) {
  const line = (p: any) => (p == null ? "" : String(p));
  for (const g of groups || []) {
    for (const sub of g?.E || []) {
      for (const it of Array.isArray(sub) ? sub : [sub]) {
        const v = parseFloat(it?.C);
        if (!isFinite(v) || v <= 1) continue;
        const t = Number(it.T) || 0;
        const p = it.P;
        const put = (key: string) => {
          odds[prefix + key] = Math.round(v * 100) / 100;
          meta[prefix + key] = { t, p: Number(p) || 0, g: gameId };
        };
        switch (g.G) {
          case 1: // Vainqueur (du match, ou de la statistique)
            if (t === 1) put("WIN_HOME");
            else if (t === 2) put("WIN_DRAW");
            else if (t === 3) put("WIN_AWAY");
            break;
          // Basket : le vainqueur n'est pas dans le groupe 1 (il n'y a pas de
          // nul) mais dans le groupe 101 — sans ce cas, aucun match de basket
          // ne passait le contrôle « cotes vainqueur présentes ».
          case 101:
            if (statOnly) break;
            if (t === 401) put("WIN_HOME");
            else if (t === 402) put("WIN_AWAY");
            break;
          case 17: // Total
            if (t === 9) put(`${totalPre}OVER_${line(p)}`);
            else if (t === 10) put(`${totalPre}UNDER_${line(p)}`);
            break;
          case 2: // Handicap — sans ligne explicite, l'issue n'est pas vérifiable.
            if (p == null) break;
            if (t === 7) put(`AH_HOME_${line(p)}`);
            else if (t === 8) put(`AH_AWAY_${line(p)}`);
            break;
          case 8: // Double chance
            if (statOnly) break;
            if (t === 4) put("DC_1X");
            else if (t === 5) put("DC_12");
            else if (t === 6) put("DC_X2");
            break;
          // ⚠️ Groupes 15 / 62 = totaux PAR ÉQUIPE (sondé le 05/09/2026 : sur
          // Newcastle – Bournemouth, G15 « Plus de 0.5 » cotait 1.125 = total
          // de l'équipe 1). Ils étaient étiquetés « mi-temps » à tort : les
          // vrais marchés de mi-temps vivent dans les sous-jeux « 1ère mi-temps ».
          case 15: // Total équipe 1
            if (statOnly) break;
            if (t === 11) put(`TT_HOME_OVER_${line(p)}`);
            else if (t === 12) put(`TT_HOME_UNDER_${line(p)}`);
            break;
          case 62: // Total équipe 2
            if (statOnly) break;
            if (t === 13) put(`TT_AWAY_OVER_${line(p)}`);
            else if (t === 14) put(`TT_AWAY_UNDER_${line(p)}`);
            break;
          case 19: // Les deux équipes marquent
            if (statOnly) break;
            if (t === 180) put("BTTS_YES");
            else if (t === 181) put("BTTS_NO");
            break;
        }
      }
    }
  }
}

export async function matchOdds(matchId: number, withStats = false) {
  const data = await bookGet(gamePath(matchId, withStats));
  const groups = data?.Value?.GE;
  if (!Array.isArray(groups)) return { odds: {}, meta: {} };

  const odds: Record<string, number> = {};
  const meta: Record<string, { t: number; p: number; g: number }> = {};
  collectOdds(groups, matchId, "", "OU_", false, odds, meta);

  if (withStats) {
    // Seuls les sous-jeux « match complet » (PN vide) : les variantes de
    // mi-temps portent le même intitulé et seraient confondues.
    const subs = (data?.Value?.SG || [])
      .filter((s: any) => s?.I && !s?.PN)
      .map((s: any) => {
        const fam = STAT_FAMILIES.find(([re]) => re.test(String(s.TG || "").trim()))?.[1];
        return fam ? { id: Number(s.I), fam } : null;
      })
      .filter(Boolean)
      .slice(0, 7);

    const pages = await Promise.all(subs.map((s: any) => bookGet(gamePath(s.id, false)).catch(() => null)));
    pages.forEach((d: any, i: number) => {
      const gs = d?.Value?.GE;
      if (Array.isArray(gs)) collectOdds(gs, subs[i].id, `ST_${subs[i].fam}_`, "", true, odds, meta);
    });
  }

  return { odds, meta };
}

// ── Clé d'appariement par noms d'équipes ──────────────────────────────
// L'identifiant du match CHANGE entre le pré-match et le live chez le
// bookmaker : on ne peut pas compter dessus pour retrouver un match dans
// le flux direct. Les noms d'équipes, eux, restent identiques.
export function teamPairKey(a: string, b: string) {
  const norm = (s: string) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");
  return `np:${norm(a)}|${norm(b)}`;
}

// Statistiques publiées dans le flux direct (SC.ST) → familles vérifiables.
// Le bookmaker les nomme : on ne mappe que les intitulés certains.
const LIVE_STAT_FAMILIES: Array<[RegExp, string]> = [
  [/^corner/i, "CORNERS"],
  [/^cartons? jaunes?/i, "YELLOW_CARDS"],
  [/^tirs cadr/i, "SHOTS_ON"],
  [/^faute/i, "FOULS"],
  [/hors[- ]jeu/i, "OFFSIDES"],
  [/^touche/i, "THROWINS"],
  [/d[ée]gagement/i, "GOALKICKS"],
];

function parseLiveStats(sc: any) {
  const stats: Record<string, { s1: number; s2: number }> = {};
  let offTarget: { s1: number; s2: number } | null = null;
  for (const grp of sc?.ST || []) {
    for (const st of grp?.Value || []) {
      const n = String(st?.N || "");
      const v = { s1: Number(st?.S1) || 0, s2: Number(st?.S2) || 0 };
      if (/^tirs non cadr/i.test(n)) { offTarget = v; continue; }
      const fam = LIVE_STAT_FAMILIES.find(([re]) => re.test(n))?.[1];
      if (fam && !stats[fam]) stats[fam] = v;
    }
  }
  // « Tirs vers le but » = tirs cadrés + tirs non cadrés.
  if (stats.SHOTS_ON && offTarget) {
    stats.SHOTS = { s1: stats.SHOTS_ON.s1 + offTarget.s1, s2: stats.SHOTS_ON.s2 + offTarget.s2 };
  }
  return stats;
}

// Phase d'un match d'après l'intitulé de période du flux direct :
//   « Mi-temps » (pause) → "halftime" ; « Match terminé » → "finished".
export function livePhase(period: string): "halftime" | "finished" | "" {
  const p = String(period || "").trim().toLowerCase();
  if (/termin|fin du match|ended|finished/.test(p)) return "finished";
  if (/^mi-temps$|^pause$|^half[- ]?time$/.test(p)) return "halftime";
  return "";
}

// Famille statistique visée par un code de marché ST_<FAM>_… (sinon null).
export function statFamilyOf(market: string) {
  const code = String(market || "").toUpperCase();
  if (!code.startsWith("ST_")) return null;
  const body = code.slice(3);
  // Toutes les formes de marché (total, vainqueur, double chance, total par
  // équipe, handicap) : l'ancien filtre ne reconnaissait que total/vainqueur/
  // handicap et laissait les autres pronostics statistiques sans règlement.
  return STAT_FAMILY_CODES.find((f) => body.startsWith(f + "_")) || null;
}

function liveGamePath(id: number, subGames: boolean) {
  return `/service-api/LiveFeed/GetGameZip?id=${id}&lng=fr&isSubGames=${subGames}&GroupEvents=true&countevents=50&grMode=4&country=${COUNTRY}&marketType=1`;
}

// Compteur EN DIRECT d'une statistique absente du bloc SC.ST (dégagements de
// but, fautes, hors-jeu, touches…) : le bookmaker tient un sous-jeu dédié
// (TG = intitulé, PN vide = match complet) dont le SC.FS est le compte courant.
export async function liveStatCount(liveMatchId: number, fam: string) {
  const data = await bookGet(liveGamePath(liveMatchId, true));
  const sub = (data?.Value?.SG || []).find((s: any) =>
    s?.I && !s?.PN && STAT_FAMILIES.find(([re]) => re.test(String(s.TG || "").trim()))?.[1] === fam);
  if (!sub) return null;
  const d = await bookGet(liveGamePath(Number(sub.I), false));
  const fs = d?.Value?.SC?.FS;
  if (!fs) return null;
  return { s1: Number(fs.S1) || 0, s2: Number(fs.S2) || 0 };
}

// ── Scores en direct d'un sport (clé = match_id ET paire d'équipes) ───
export async function liveScores(sport: string) {
  const sportId = SPORT_IDS[sport];
  const data = await bookGet(
    `/service-api/LiveFeed/Get1x2_VZip?sports=${sportId}&count=400&lng=fr&mode=4&country=${COUNTRY}&getEmpty=true`,
  );
  const map = new Map<number, any>();
  for (const m of data?.Value || []) {
    if (!m?.I) continue;
    const sc = m.SC || {};
    const fs = sc.FS || {};
    const periods = (sc.PS || []).map((p: any) => ({
      key: p?.Key,
      name: p?.Value?.NF || "",
      s1: Number(p?.Value?.S1) || 0,
      s2: Number(p?.Value?.S2) || 0,
    }));
    const entry = {
      live_id: Number(m.I),
      s1: Number(fs.S1) || 0,
      s2: Number(fs.S2) || 0,
      period: sc.CPS || "",
      periods,
      // Chronomètre du match (secondes) → minute en cours affichée en direct.
      timer_sec: Number(sc.TS) || 0,
      // Statistiques en direct (corners, tirs cadrés…) : mémorisées en continu,
      // elles servent au règlement des marchés statistiques à la fin du match.
      stats: parseLiveStats(sc),
    };
    map.set(m.I, entry);
    // Double indexation par noms d'équipes : c'est elle qui retrouve le
    // match quand le bookmaker a changé son identifiant en passant live.
    if (m.O1 && m.O2) map.set(teamPairKey(m.O1, m.O2) as any, entry);
  }
  return map;
}