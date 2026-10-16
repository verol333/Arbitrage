// ═══════════════════════════════════════════════════════════════
// RECONSTRUCTION DU coupon_data 1xBet MANQUANT
//
// CONSTAT MESURÉ (09/08/2026, 1 000 opportunités) : le scanner n'attache le
// `coupon_data` 1xBet qu'à ~20 % des jambes 1xBet. Les 80 % restantes arrivent
// sans identifiants → aucun code coupon possible, alors que `onexbet_match_id`
// est présent sur 100 % d'entre elles.
//
// Or le couple (market_family, leg_label) détermine de façon DÉTERMINISTE le
// Type/Param 1xBet : sur les jambes qui ont bien leur coupon_data, la table
// observée compte 24 couples distincts et ZÉRO conflit. La dérivation a été
// validée contre 95 jambes réelles : 95 exactes, 0 divergence.
//
// On reconstruit donc le coupon_data manquant à l'ingestion, exactement comme
// le scanner l'aurait envoyé. Règle de prudence : en cas de marché non reconnu
// (ou de marché de période type « 1MT »), on ne devine RIEN et on laisse la
// jambe sans code — mieux vaut pas de code qu'un code sur la mauvaise sélection.
// ═══════════════════════════════════════════════════════════════

import { getMobileSubgames } from "./onexbetMobileApi.ts";

// Sélections sans paramètre (1X2 / double chance), libellé normalisé sans accent.
const PLAIN_TYPES: Record<string, number> = {
  "domicile": 1,
  "dom.": 1,
  "dom": 1,
  "nul": 2,
  "x": 2,
  "exterieur": 3,
  "ext.": 3,
  "ext": 3,
  "domicile ou nul": 4,
  "un gagnant (12)": 5,
  "nul ou exterieur": 6,
};

function normalize(s: unknown): string {
  return String(s ?? "").replace(/\u2212/g, "-").trim();
}

/** Type/Param 1xBet déduits du marché + du libellé, ou null si non reconnu. */
export function deriveOnexbetSelection(marketFamily: unknown, label: unknown) {
  const M0 = normalize(marketFamily);
  const L = normalize(label);
  if (!M0 || !L) return null;

  // Marchés de mi-temps (1MT/2MT) : les Types 1xBet sont les MÊMES que ceux du
  // match complet, mais le pari doit viser le GameId du SOUS-JEU « 1ère/2ème
  // mi-temps » (vérifié en réel : Under 1.5 @3.01 n'existait QUE sur le sous-jeu,
  // pas sur le match complet). On dérive donc normalement après retrait du
  // préfixe ; le GameId est ensuite corrigé par remapOnexbetHalfCoupons — et à
  // défaut le coupon est abandonné : jamais de code sur la mauvaise sélection.
  // NB : l'ancien garde /\bMT\b/ ne matchait PAS « 1MT » (pas de frontière de
  // mot entre « 1 » et « M ») — les libellés 1X2 de mi-temps passaient donc à
  // travers et produisaient des codes match complet erronés.
  const M = M0.replace(/^\s*[12]\s*MT\b\s*/i, "");

  if (/^BTTS/i.test(M)) {
    if (/^oui$/i.test(L)) return { betType: 180, param: null };
    if (/^non$/i.test(L)) return { betType: 181, param: null };
    return null;
  }

  const norm = L.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (PLAIN_TYPES[norm] != null) return { betType: PLAIN_TYPES[norm], param: null };

  const raw = (L.match(/[-+]?\d+(?:\.\d+)?/) || [])[0];
  if (raw == null) return null;
  const value = parseFloat(raw);

  // Handicaps : le paramètre garde son signe, tel qu'il figure dans le libellé.
  if (/handicap/i.test(M)) {
    if (/^dom\./i.test(L)) return { betType: 7, param: value };
    if (/^ext\./i.test(L)) return { betType: 8, param: value };
    return null;
  }

  // Totaux : le paramètre est toujours positif, le sens vient du + / - du libellé.
  const over = L.includes("+");
  const param = Math.abs(value);
  if (/total\s+dom\.?/i.test(M)) return { betType: over ? 11 : 12, param };
  if (/total\s+ext\.?/i.test(M)) return { betType: over ? 13 : 14, param };
  // Couvre « Total Buts Match 2.5 » (match complet), « Total Buts 1.5 » (mi-temps)
  // ET les totaux de statistiques (« Corners Total 12.5 », « Cartons Total 4.5 ») :
  // dans le sous-jeu concerné, 1xBet utilise les mêmes Types 9/10 (vérifié sur
  // le flux réel : Corners Total +12.5 = T9/P12.5, cote identique à l'annonce).
  if (/total/i.test(M)) return { betType: over ? 9 : 10, param };

  return null;
}

/**
 * Complète en place le coupon_data 1xBet absent des jambes d'un lot.
 * @returns { filled, skipped } — skipped = marchés non reconnus, laissés intacts.
 */
export function fillMissingOnexbetCoupons(rows: any[]) {
  let filled = 0, skipped = 0;

  for (const row of rows) {
    const gameId = row?.onexbet_match_id;
    if (!gameId) continue;

    for (const legKey of ["a", "b"]) {
      if (String(row[`leg_${legKey}_book`] || "").toLowerCase() !== "1xbet") continue;
      if (row[`leg_${legKey}_coupon`]) continue;

      const sel = deriveOnexbetSelection(row.market_family, row[`leg_${legKey}_label`]);
      if (!sel) { skipped++; continue; }

      row[`leg_${legKey}_coupon`] = {
        book: "1xbet",
        gameId: String(gameId),
        // gameId provisoire = match complet ; corrigé ensuite par
        // remapOnexbetHalfCoupons pour les marchés 1MT/2MT.
        kind: row.is_live ? 1 : 3,
        betType: sel.betType,
        param: sel.param,
        price: Number(row[`leg_${legKey}_odd`]) || 1,
        read_at: new Date().toISOString(),
      };
      filled++;
    }
  }

  return { filled, skipped };
}

// ═══════════════════════════════════════════════════════════════
// REMAP DES COUPONS 1xBET DE MI-TEMPS VERS LE SOUS-JEU
//
// CAUSE RACINE des « codes qui ne passent pas » (mesurée le 11/08/2026) :
// ~19 % des jambes 1xBet codées portent sur des marchés 1MT/2MT, or leur
// coupon visait le GameId du MATCH COMPLET. SaveCoupon générait alors un code
// sur le marché match complet (mauvaise sélection, mauvaise cote — le
// CheckCf:0 de secours masquait l'écart et délivrait le code quand même).
// Vérifié en réel : « 1MT Total Buts 1.5 » à 3.01 n'existe que sur le
// sous-jeu « 1ère mi-temps » (GameId distinct), pas sur le match complet.
//
// Ce remap interroge GetGameZip (1 appel par match, dédupliqué) pour trouver
// le GameId du sous-jeu de la bonne mi-temps et l'écrire dans le coupon.
// Sous-jeu introuvable ou appel en échec → coupon ABANDONNÉ (null) : mieux
// vaut pas de code qu'un code sur la mauvaise sélection.
// ═══════════════════════════════════════════════════════════════

const HALF_PREFIX_RE = /^\s*([12])\s*MT\b/i;

// Statistiques secondaires : ces marchés ne vivent JAMAIS sur le match complet.
// Un libellé qui en contient une et qu'on n'arrive pas à rattacher à son
// sous-jeu est abandonné — jamais de code sur le marché buts du match.
const STAT_HINT_RE = /corner|carton|jaune|rouge|tir|faute|hors[-\s]?jeu|penalt|possession|remplacement|joueur|touche|degagement|dégagement|arret|arrêt/i;

// Marchés d'une PÉRIOD E précise autre que la mi-temps : set (tennis),
// quart-temps (basket), période (hockey), manche. Ils vivent dans leur propre
// sous-jeu chez 1xBet (« 1er set » = GameId distinct). Sans ce rattrapage, un
// « Total Jeux 1er Set 8.5 » était cherché sur le MATCH COMPLET : soit la ligne
// n'existait pas (opportunité perdue), soit elle existait pour le match entier
// et le pari posé n'était pas celui affiché.
const PERIOD_RE = /\b\d\s*(?:er|ere|ère|eme|ème|e)?\s*(?:set|quart|quart[-\s]?temps|periode|période|manche)\b/i;

const GAMEZIP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchOnexbetSubgames(gameId: string, live = false): Promise<any[] | null> {
  // Voie principale : API MOBILE (la seule joignable depuis nos serveurs — le
  // site 1xbet.cg est filtré, ce qui bloquait TOUS les marchés de mi-temps,
  // de set et de statistiques). Le site reste en secours.
  return (await getMobileSubgames(gameId, live).catch(() => null))
    ?? (await fetchSubgamesOnce(gameId))
    ?? (await fetchSubgamesOnce(gameId));
}

async function fetchSubgamesOnce(gameId: string): Promise<any[] | null> {
  try {
    const r = await fetch(
      `https://1xbet.cg/service-api/LineFeed/GetGameZip?id=${gameId}&lng=fr&isSubGames=true&GroupEvents=false&partner=1`,
      {
        headers: {
          "user-agent": GAMEZIP_UA,
          "accept": "application/json",
          "origin": "https://1xbet.cg",
          "referer": "https://1xbet.cg/fr/line",
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    const j = await r.json().catch(() => null);
    return Array.isArray(j?.Value?.SG) ? j.Value.SG : null;
  } catch {
    return null;
  }
}

const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const isHalfName = (n: string) => n.includes("mi-temps") || n.includes("half");

/**
 * Sous-jeux 1xBet mis à plat : chaque entrée porte son NOM et son PARENT.
 * Le flux liste les statistiques puis LEURS mi-temps juste après
 * (« Corners », « 1ère mi-temps », « 2ème mi-temps », « Cartons jaunes », …) :
 * une mi-temps appartient donc à la dernière statistique rencontrée, et les
 * mi-temps placées avant toute statistique sont celles des BUTS du match.
 */
function flattenSubgames(subs: any[] | null) {
  const out: { id: string; name: string; parent: string; half: number | null }[] = [];
  let parent = "";
  for (const sg of subs || []) {
    const name = norm(sg.PN || sg.TG || sg.TN);
    const id = sg.I != null ? String(sg.I) : null;
    if (!id) continue;
    if (isHalfName(name)) {
      const half = Number((name.match(/([12])/) || [])[1]) || null;
      out.push({ id, name, parent, half });
    } else {
      parent = name;
      out.push({ id, name, parent: "", half: null });
    }
  }
  return out;
}

/**
 * Sous-jeu qui porte réellement le marché demandé, ou null (→ coupon abandonné).
 *
 * CAUSE RACINE CORRIGÉE ICI (constatée sur « Corners Vainqueur », Minnesota vs
 * Atlanta) : le scanner attache le GameId du MATCH COMPLET aux marchés de
 * statistiques. SaveCoupon générait alors un code « Victoire 2 » sur le match
 * (cote 4.83) là où l'app annonçait « Corners vainqueur » (cote 4.05) : le pari
 * posé n'était pas celui affiché, et l'arbitrage n'était plus garanti.
 */
function pickSubgame(subs: any[] | null, family: string): { id: string } | { drop: true } | null {
  const f = norm(family);
  const half = Number((f.match(HALF_PREFIX_RE) || [])[1]) || null;
  const flat = flattenSubgames(subs);

  // Statistique visée : nom de sous-jeu le plus long contenu dans le marché.
  const stat = flat
    .filter((s) => !s.half && s.name)
    .sort((a, b) => b.name.length - a.name.length)
    .find((s) => f.includes(s.name));

  if (!stat) {
    // Marché de statistique ou de période (set, quart-temps…) non rattachable
    // → on abandonne le code plutôt que de le poser sur le match complet.
    if (STAT_HINT_RE.test(family) || PERIOD_RE.test(family)) return { drop: true };
    if (!half) return null; // marché buts du match complet : rien à remapper
    const goalHalf = flat.find((s) => s.half === half && s.parent === "");
    return goalHalf ? { id: goalHalf.id } : { drop: true };
  }

  if (!half) return { id: stat.id };
  const statHalf = flat.find((s) => s.half === half && s.parent === stat.name);
  return statHalf ? { id: statHalf.id } : { drop: true };
}

/**
 * Corrige en place le gameId des coupons 1xBet portant sur un marché 1MT/2MT.
 * Ne lève jamais : chaque jambe est soit remappée, soit abandonnée (coupon null).
 */
export async function remapOnexbetHalfCoupons(rows: any[]) {
  const legs: { row: any; k: string; c: any; family: string; main: string; live: boolean; done?: boolean }[] = [];
  for (const row of rows) {
    const family = String(row?.market_family || "");
    // Marché concerné = mi-temps OU statistique secondaire (corners, cartons,
    // tirs, hors-jeu…). Les marchés buts du match complet vivent bien sur le
    // GameId principal et n'ont rien à remapper.
    if (!HALF_PREFIX_RE.test(family) && !STAT_HINT_RE.test(family) && !PERIOD_RE.test(family)) continue;
    for (const k of ["a", "b"]) {
      const c = row[`leg_${k}_coupon`];
      if (c && String(c.book || "").toLowerCase() === "1xbet" && c.gameId) {
        // On repart TOUJOURS du match principal pour lister les sous-jeux :
        // interroger un gameId déjà remappé (ou décalé par le scanner) ne
        // renvoie aucune liste, ce qui bloquait le rattachement.
        legs.push({ row, k, c, family, main: String(row?.onexbet_match_id || c.gameId), live: !!row?.is_live });
      }
    }
  }
  if (!legs.length) return { half_legs: 0, matches: 0, remapped: 0, dropped: 0 };

  const byGame = new Map<string, typeof legs>();
  for (const l of legs) {
    const key = `${l.main}|${l.live ? 1 : 0}`;
    if (!byGame.has(key)) byGame.set(key, []);
    byGame.get(key)!.push(l);
  }

  let remapped = 0, dropped = 0, pending = 0;
  const drop = (l: (typeof legs)[number]) => { l.row[`leg_${l.k}_coupon`] = null; l.done = true; dropped++; };
  // Lecture des sous-jeux impossible (1xBet injoignable / limité) : on ne DÉTRUIT
  // plus le coupon — c'était la cause de 100 % des jambes mi-temps sans
  // identifiants. On le garde marqué « à réparer » : la pose le refuse tant que
  // le marquage est là, et onexbetHalfRepair le corrige au prochain passage.
  const markPending = (l: (typeof legs)[number]) => { l.c.half_pending = true; l.done = true; pending++; };

  try {
    const ids = [...byGame.keys()];
    const CONC = 6;
    for (let i = 0; i < ids.length; i += CONC) {
      await Promise.all(ids.slice(i, i + CONC).map(async (key) => {
        const [gid, liveFlag] = key.split("|");
        const subs = await fetchOnexbetSubgames(gid, liveFlag === "1");
        if (subs === null) { for (const l of byGame.get(key)!) markPending(l); return; }
        for (const l of byGame.get(key)!) {
          const target = pickSubgame(subs, l.family);
          if (target && "id" in target) { l.c.gameId = target.id; delete l.c.half_pending; l.done = true; remapped++; }
          else if (target === null) { l.done = true; } // match complet : coupon inchangé
          else drop(l);
        }
      }));
    }
  } catch { /* filet de sécurité ci-dessous */ }

  // Toute jambe non traitée (échec inattendu) est mise en attente de réparation,
  // jamais posée en l'état : on ne génère aucun code sur le GameId du match
  // complet pour un marché de mi-temps, mais on ne perd plus l'opportunité.
  for (const l of legs) if (!l.done) markPending(l);

  return { half_legs: legs.length, matches: byGame.size, remapped, dropped, pending };
}