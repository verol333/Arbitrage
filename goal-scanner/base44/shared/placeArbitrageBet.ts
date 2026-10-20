// ═══════════════════════════════════════════════════════════════════
// MOTEUR DE PRISE DE PARI D'ARBITRAGE — logique partagée, INDÉPENDANTE des books.
//
// Utilisé par : autoPlaceBet (manuel) et autoWatchTick (surveillance 24/7).
//
// Tout ce qui est propre à un bookmaker vit dans autoBookAdapters.ts :
// pour brancher un book de plus, il suffit d'y ajouter une entrée. Ce fichier
// n'a alors AUCUNE ligne à modifier.
//
// Règle d'or : si UNE seule jambe n'est pas confirmée par le bookmaker,
// le ticket n'est PAS validé.
// ═══════════════════════════════════════════════════════════════════

import { ADAPTERS, AUTO_BOOKS } from "./autoBookAdapters.ts";
import { planStakes, minStakeOf } from "./autoStakePlan.ts";
import { learnFromPartial, learnFromRefusal, readStakeLimits } from "./bookStakeLimits.ts";
import { coverElsewhere } from "./coverElsewhere.ts";
import { coverRefusedLeg, isTemporaryBlock } from "./coverRefusedLeg.ts";
import { cashoutExposedLeg } from "./exposedCashout.ts";
import { AUTO_SUSPENDED_BOOKS, bookLiveExcludedMessage, bookSuspendedMessage, isBookLiveExcluded, LIVE_AUTO_SUSPENDED, LIVE_SUSPENDED_MESSAGE } from "./liveSuspend.ts";
import { normalizeLegLabel } from "./legLabelNormalize.ts";
import { isOffline, isUnplayableRefusal, markOffline, OFFLINE_TTL_MS } from "./liveAvailability.ts";
import { isAmbiguousRefusal, isExplicitRefusal, mustGoFirstLive, orderLegs } from "./placementOrder.ts";
import { verifyBalancesBeforePlacing } from "./prePlaceBalance.ts";
import { cachedResolve, ttlFor } from "./sharedResolve.ts";

export { AUTO_BOOKS };

/** Identifiant de sélection, quel que soit le bookmaker qui l'a produit. */
const selectionIdOf = (sel: any): unknown =>
  sel?.selectionId ?? sel?.selection_id ?? sel?.id ?? null;

/**
 * Signature STABLE d'une opportunité : le scanner recrée ses enregistrements à
 * chaque cycle (nouvel identifiant), donc l'identifiant seul ne protège pas des
 * doublons. Cette empreinte reste identique tant qu'il s'agit du même pari.
 */
export function oppSignature(opp: Record<string, any>): string {
  const clean = (v: unknown) => String(v ?? "").toLowerCase().trim();
  return [
    clean(opp.match_label),
    clean(opp.market_family),
    clean(opp.leg_a_book), clean(opp.leg_a_label),
    clean(opp.leg_b_book), clean(opp.leg_b_label),
  ].join("|");
}

import { openBlob } from "./credVault.ts";
export function decodeCred(blob: string): Record<string, any> | null {
  return openBlob(blob);
}

export interface PlacementReport {
  ok: boolean;
  stage: string;
  reason: string;
  dry_run?: boolean;
  steps: string[];
  sessions?: Record<string, unknown>;
  odds?: Record<string, unknown>;
  ticket?: Record<string, any>;
  plan?: Record<string, any>;
  liquidity?: Record<string, any>[];
  unusable_books?: string[];
  blocked?: unknown[];
  placed?: unknown[];
  balances?: Record<string, unknown>;
  minimums?: Record<string, number>;
}

/**
 * Exécute (ou simule) la prise de pari sur une opportunité.
 * `credentials` = { congobet: "<b64>", betpawa: "<b64>", … } tel que stocké sur le compte.
 */
export async function runPlacement(opts: {
  opp: Record<string, any>;
  credentials: Record<string, string>;
  dryRun?: boolean;
  maxTotal?: number;
  /** Plafond de mise par bookmaker choisi par l'utilisateur : { apollo: 1000, … }.
   *  0 ou absent pour un book = pas de plafond (tout le solde disponible). */
  maxStakeByBook?: Record<string, number>;
  /** Sessions pré-connectées (par nom canonique de book) — évite les
   *  reconnexions répétées quand on tente plusieurs opps du même lot. */
  preConnected?: Record<string, any>;
  /** Adaptateurs de remplacement — UNIQUEMENT pour les back-tests simulés. */
  adapters?: Record<string, any>;
}): Promise<PlacementReport> {
  const { opp, credentials, dryRun = true, maxTotal = 0, maxStakeByBook, preConnected } = opts;
  const ADP = opts.adapters || ADAPTERS;

  // ── SUSPENSION GLOBALE DES LIVES ────────────────────────────────────
  // Barrière ultime : quel que soit le chemin d'entrée (surveillance,
  // placement instantané, déclenchement manuel), aucune mise automatique
  // ne part sur un match en cours tant que la suspension est active.
  // Le rattrapage des positions déjà ouvertes ne passe pas par ici.
  if (LIVE_AUTO_SUSPENDED && opp?.is_live) {
    return {
      ok: false, stage: "live_suspended",
      reason: LIVE_SUSPENDED_MESSAGE,
      steps: ["Opportunité LIVE écartée — suspension globale des paris automatiques sur les matchs en cours"],
      sessions: {}, odds: {},
    } as any;
  }

  // Plafond de mise pour un book : le scanner dit « 1xbet » mais l'utilisateur
  // peut avoir réglé son plafond sous « 1xbet_mobile » — on accepte les deux.
  const capOf = (book: string): number => {
    const m = maxStakeByBook || {};
    const v = m[book] ?? (book === "1xbet" ? m["1xbet_mobile"] : book === "1xbet_mobile" ? m["1xbet"] : undefined);
    return Number(v) > 0 ? Number(v) : 0;
  };
  const steps: string[] = [];
  const bookA = String(opp.leg_a_book || "").toLowerCase();
  const bookB = String(opp.leg_b_book || "").toLowerCase();

  // ── Books automatisables ? ──
  const unknown = [bookA, bookB].filter((b) => !ADP[b]);
  if (unknown.length) {
    return { ok: false, stage: "credentials", steps, reason: `${unknown.join(" et ")} ne prend pas encore les paris automatiques` };
  }
  const adA = ADP[bookA];
  const adB = ADP[bookB];

  // ── BOOK RETIRÉ DE LA MISE AUTOMATIQUE RÉELLE (voir liveSuspend.ts) ──
  // Barrière placée AVANT toute connexion : aucune mise ne part sur une
  // opportunité qui implique un book n'ayant jamais confirmé un pari réel.
  const suspended = !dryRun && [bookA, bookB].find((b) => AUTO_SUSPENDED_BOOKS.includes(b));
  if (suspended) {
    return { ok: false, stage: "book_suspended", steps, reason: bookSuspendedMessage(suspended), unusable_books: [suspended] };
  }

  // ── BOOK ÉCARTÉ DU DIRECT (voir liveSuspend.ts) ────────────────────────
  // Barrière placée AVANT toute connexion : sur un match EN COURS, aucune mise
  // ne part chez un bookmaker dont les refus tombent après coup et laissent
  // l'autre jambe à découvert. Le pré-match n'est pas concerné.
  const liveOut = !dryRun && opp?.is_live && [bookA, bookB].find((b) => isBookLiveExcluded(b, true));
  if (liveOut) {
    return {
      ok: false, stage: "book_live_excluded", steps,
      reason: bookLiveExcludedMessage(liveOut), unusable_books: [liveOut],
    };
  }

  // ── Identifiants enregistrés ──
  // Alias : le scanner dit « 1xbet » mais l'utilisateur stocke ses credentials
  // sous « 1xbet_mobile » (clé du login card). On accepte les deux.
  const credKeyOf = (book: string) => credentials[book] ? book : (book === "1xbet" && credentials["1xbet_mobile"] ? "1xbet_mobile" : book);
  const credA = credentials[credKeyOf(bookA)] ? decodeCred(credentials[credKeyOf(bookA)]) : null;
  const credB = credentials[credKeyOf(bookB)] ? decodeCred(credentials[credKeyOf(bookB)]) : null;
  if (!credA || !credB) {
    return {
      ok: false, stage: "credentials", steps,
      reason: `Comptes non connectés pour ${!credA ? bookA : bookB} — reliez-le dans Mise Auto`,
    };
  }
  steps.push(`Identifiants trouvés pour ${bookA} et ${bookB}`);

  // ── Connexions + soldes ──
  // OPTIMISATION LATENCE : si autoWatchCore a pré-connecté les books, on
  // réutilise les sessions. Chaque connect = 2-3s d'API ; sur 9 opps live
  // avec les mêmes books, on passe de 18-27s à 2-3s.
  let connA: any, connB: any;
  if (preConnected && preConnected[bookA] && preConnected[bookB]) {
    connA = preConnected[bookA];
    connB = preConnected[bookB];
  } else {
    [connA, connB] = await Promise.all([adA.connect(credA), adB.connect(credB)]);
  }
  const sessions: Record<string, unknown> = {};
  const sessionOf = (c: any) => (c?.sessionInfo ? { expiresAt: c.sessionInfo.expiresAt, minutesLeft: c.sessionInfo.minutesLeft, note: c.sessionInfo.reason } : {});

  for (const [book, conn] of [[bookA, connA], [bookB, connB]] as const) {
    if (!(conn as any).ok) {
      sessions[book] = (conn as any).session || null;
      return { ok: false, stage: "login", reason: (conn as any).reason, steps, sessions, unusable_books: [book] };
    }
    sessions[book] = { balance: (conn as any).balance, currency: (conn as any).currency, ...sessionOf(conn) };
    steps.push(`${book} connecté — solde ${(conn as any).balance ?? "?"} ${(conn as any).currency || ""}`);
  }

  // ── Contrôle de LIQUIDITÉ ──
  const liquidity = [
    { book: bookA, balance: (connA as any).balance, currency: (connA as any).currency },
    { book: bookB, balance: (connB as any).balance, currency: (connB as any).currency },
  ].map((b) => {
    const min = minStakeOf(b.book);
    const bal = b.balance === null || b.balance === undefined ? null : Number(b.balance);
    const usable = bal === null ? null : Math.floor(bal * 0.95);
    return {
      ...b, min, usable,
      ok: usable !== null && usable >= min,
      message: bal === null
        ? `${b.book} : solde illisible — aucune mise placée`
        : usable! < min
          ? `${b.book} n'a pas assez de liquidité : ${usable} ${b.currency || "F"} disponibles, minimum ${min} ${b.currency || "F"} — rechargez le compte, la surveillance reste active`
          : `${b.book} : ${usable} ${b.currency || "F"} engageables`,
    };
  });
  const dry = liquidity.filter((l) => !l.ok);
  if (dry.length) {
    return {
      ok: false, stage: "liquidity", steps, liquidity, sessions,
      unusable_books: dry.map((l) => l.book),
      // ⚠️ « Solde illisible » (coupure réseau, erreur 500 du bookmaker) n'est
      // PAS un compte vide. Confondre les deux faisait annoncer « compte sans
      // solde » — puis mettre le compte en sommeil — à des utilisateurs qui
      // avaient bel et bien de l'argent. Ces cas sont signalés à part pour ne
      // jamais compter comme un solde vide.
      unreadable_books: dry.filter((l) => l.usable === null).map((l) => l.book),
      reason: dry.map((l) => l.message).join(" · "),
      balances: { [bookA]: (connA as any).balance, [bookB]: (connB as any).balance },
    };
  }
  steps.push(liquidity.map((l) => l.message).join(" · "));

  // ── Résolution des sélections + cotes fraîches ──
  // Libellés traduits en langage explicite AVANT tout résolveur : « +154.5 » /
  // « −154.5 » sur un marché de total deviennent « Plus de » / « Moins de ».
  // Sans ça, 1win, Apollo et betPawa déclaraient la sélection introuvable sur
  // tous les totaux signés (basket, tennis, tennis de table).
  const labelA = normalizeLegLabel(opp.market_family, opp.leg_a_label);
  const labelB = normalizeLegLabel(opp.market_family, opp.leg_b_label);

  // MUTUALISATION : la sélection et la cote sont les mêmes pour tous les
  // comptes. On passe par le cache partagé (voir sharedResolve.ts) : le premier
  // compte déclenche l'appel réseau, les suivants réutilisent la réponse tant
  // qu'elle est fraîche (2 s en live, 15 s en pré-match).
  const ttl = ttlFor(opp.is_live);
  // `fresh` = lecture OBLIGATOIREMENT neuve (cache ignoré). Le premier examen
  // peut se contenter du cache mutualisé, mais tout contrôle qui précède un
  // engagement d'argent doit voir la cote réelle de l'instant : avec le cache,
  // le « contrôle final » revalidait une cote vieille de 2 s en live et jusqu'à
  // 15 s en pré-match, et laissait donc passer des paris dont la marge avait
  // déjà disparu. C'était la seconde faille du filet de sécurité.
  const readLegs = (fresh = false) => Promise.all([
    // Le site du compte accompagne la lecture : betPawa n'a pas le même
    // catalogue ni les mêmes prix d'un pays à l'autre.
    cachedResolve(bookA, adA, opp, opp.leg_a_coupon || null, opp[adA.matchIdField], labelA, fresh ? 0 : ttl, { host: (connA as any)?.host }),
    cachedResolve(bookB, adB, opp, opp.leg_b_coupon || null, opp[adB.matchIdField], labelB, fresh ? 0 : ttl, { host: (connB as any)?.host }),
  ]);

  const [legA, legB] = await readLegs();
  const blocked = [!legA.ok ? { book: bookA, ...legA } : null, !legB.ok ? { book: bookB, ...legB } : null].filter(Boolean);
  if (blocked.length) {
    return {
      ok: false, stage: "selection", steps, blocked, sessions,
      reason: blocked.map((b: any) => `${b.book} : ${b.reason}`).join(" · "),
      balances: { [bookA]: (connA as any).balance, [bookB]: (connB as any).balance },
    };
  }
  // ⚠️ LE DOUBLE CONTRÔLE « SÉLECTION CONNUE INJOUABLE » A ÉTÉ SUPPRIMÉ ICI.
  // Il tournait DEUX fois (à la première lecture et juste avant la pose) et
  // abandonnait 56 opportunités valides par jour. Un seul contrôle subsiste,
  // au plus près de la pose, avec une mémoire ramenée à 40 s.

  const odds = {
    [bookA]: { annoncee: opp.leg_a_odd, fraiche: (legA as any).odds, selection: (legA as any).selection },
    [bookB]: { annoncee: opp.leg_b_odd, fraiche: (legB as any).odds, selection: (legB as any).selection },
  };
  steps.push(`Cotes fraîches confirmées : ${bookA} ${(legA as any).odds} (annoncée ${opp.leg_a_odd}) / ${bookB} ${(legB as any).odds} (annoncée ${opp.leg_b_odd})`);

  // ── PLAFOND ET PLANCHER RÉELS DU BOOKMAKER ─────────────────────────────
  // Aucun flux de cotes n'annonce la mise maximum d'un marché : on ne
  // l'apprenait qu'au refus, l'autre jambe déjà engagée (incident du
  // 14/09/2026 : 101 500 F engagés sur 1win, 1xBet plafonné à 19 100 F). Les
  // limites déjà constatées sont donc appliquées AVANT de calculer les mises.
  const isLiveOpp = !!opp.is_live;
  const [limA, limB] = await Promise.all([
    readStakeLimits(bookA, opp.market_family, isLiveOpp),
    readStakeLimits(bookB, opp.market_family, isLiveOpp),
  ]);

  // ── PLAFOND EXACT DE LA SÉLECTION, LU CHEZ LE BOOKMAKER ────────────────
  // Une limite « apprise par refus » vaut pour un marché en général, alors que
  // le plafond réel dépend du MATCH et de la SÉLECTION. 1xBet accepte de le
  // dire avant toute mise (MobileMaxBet) : c'est ce chiffre-là qui commande.
  // Lu via l'adaptateur (`maxStake`) : aucun bookmaker n'est nommé ici, et un
  // back-test peut donc rejouer ce chemin avec des adaptateurs simulés.
  const realMax = await Promise.all([
    adA.maxStake ? adA.maxStake(connA as any, (legA as any).selection).catch(() => null) : Promise.resolve(null),
    adB.maxStake ? adB.maxStake(connB as any, (legB as any).selection).catch(() => null) : Promise.resolve(null),
  ]);
  // Books dont le plafond RÉEL de la sélection a pu être lu avant la mise : leur
  // refus n°1 (« la mise maximum est X ₣ ») est donc écarté d'avance. Ils sont
  // traités comme « acceptation vérifiée » pour l'ordre de pose (voir plus bas).
  const maxVerified = new Set<string>();
  [limA, limB].forEach((lim, i) => {
    const m = realMax[i];
    if (!m) return;
    lim.max = lim.max > 0 ? Math.min(lim.max, m) : m;
    maxVerified.add(i === 0 ? bookA : bookB);
    steps.push(`${i === 0 ? bookA : bookB} : maximum réel de cette sélection lu avant mise — ${m} F`);
  });
  const capWith = (book: string, lim: { max: number }) => {
    const user = Number(capOf(book)) || 0;
    const known = Number(lim.max) || 0;
    if (!known) return user;
    return user > 0 ? Math.min(user, known) : known;
  };
  const known = [
    limA.max ? `${bookA} max ${limA.max} F` : null, limA.min ? `${bookA} min ${limA.min} F` : null,
    limB.max ? `${bookB} max ${limB.max} F` : null, limB.min ? `${bookB} min ${limB.min} F` : null,
  ].filter(Boolean);
  if (known.length) steps.push(`Limites déjà constatées sur ce marché : ${known.join(" · ")} — mises calculées dans ces bornes`);

  // ── Répartition des mises ──
  const plan = planStakes({
    bookA, bookB,
    oddA: (legA as any).odds, oddB: (legB as any).odds,
    balanceA: Number((connA as any).balance || 0), balanceB: Number((connB as any).balance || 0),
    maxTotal: Number(maxTotal) || 0,
    maxStakeA: capWith(bookA, limA), maxStakeB: capWith(bookB, limB),
    minStakeA: limA.min, minStakeB: limB.min,
  });
  if (!plan.ok) return { ok: false, stage: "stakes", reason: plan.reason, plan, steps, sessions, odds };
  steps.push(`Mises calculées : ${bookA} ${plan.stakeA} F / ${bookB} ${plan.stakeB} F — profit garanti ${plan.profitMin} F`);

  if (dryRun) {
    return {
      ok: true, dry_run: true, stage: "ready",
      reason: "Tout est vert — le pari peut être placé réellement",
      plan, steps, liquidity, sessions, odds,
      minimums: { [bookA]: minStakeOf(bookA), [bookB]: minStakeOf(bookB) },
    };
  }

  // ── Contrôle final : attente si un marché est momentanément verrouillé,
  //    puis RECALCUL de l'arbitrage sur les cotes réellement disponibles.
  // Pour le LIVE, on attend 3s (pas 30s) : les cotes bougent à la seconde,
  // attendre 30s = garantir que l'arbitrage a disparu. 2 essais suffisent.
  const isLive = !!opp.is_live;
  // LIVE : AUCUNE attente. Mesuré le 28/08/2026 : l'étape de contrôle final
  // consommait 30 s de médiane sur les tentatives live — en direct, une cote de
  // 30 s est morte, et attendre garantissait la disparition de la marge. Un
  // marché verrouillé en live fait donc abandonner immédiatement.
  const MAX_TRIES = isLive ? 1 : 4;
  const WAIT_MS = isLive ? 0 : 30000;
  let checkA: any = null, checkB: any = null;
  // ── LIVE : UN SEUL CONTRÔLE RÉSEAU AVANT LA POSE ──────────────────────
  // Mesuré le 07/09/2026 : 26 s de médiane par tentative live, pour TROIS
  // relectures complètes des deux jambes (examen initial, contrôle final,
  // dernier contrôle avant pose). En direct, ces trois tours se suivent à
  // quelques secondes d'intervalle et lisent la même chose — mais chaque tour
  // coûte ~5 s par book, et pendant ce temps la sélection part hors ligne.
  // Le contrôle final est donc supprimé en live : la relecture qui compte est
  // celle faite juste avant la pose (`rechecks`), sur laquelle la marge ET les
  // mises sont recalculées. En pré-match, où les cotes sont stables et
  // l'attente utile, le triple contrôle est conservé tel quel.
  if (isLive) {
    steps.push("Live : contrôle final fusionné avec la relecture d'avant-pose (latence réduite)");
    checkA = legA; checkB = legB;
  }
  for (let attempt = 1; !isLive && attempt <= MAX_TRIES; attempt++) {
    [checkA, checkB] = await readLegs(true);
    if (checkA.ok && checkB.ok) break;
    const stuck = [!checkA.ok ? bookA : null, !checkB.ok ? bookB : null].filter(Boolean).join(" et ");
    if (attempt < MAX_TRIES) {
      steps.push(`${stuck} momentanément bloqué — attente de ${WAIT_MS / 1000}s puis nouvel essai (${attempt}/${MAX_TRIES - 1})`);
      await new Promise((r) => setTimeout(r, WAIT_MS));
    }
  }
  const stillBlocked = [!checkA.ok ? { book: bookA, ...checkA } : null, !checkB.ok ? { book: bookB, ...checkB } : null].filter(Boolean);
  if (stillBlocked.length) {
    return {
      ok: false, stage: "verify", steps, blocked: stillBlocked, plan, sessions, odds,
      reason: `Marché toujours bloqué après ${MAX_TRIES} essais : ${stillBlocked.map((b: any) => `${b.book} — ${b.reason}`).join(" · ")} — aucune mise engagée`,
    };
  }

  const freshA = Number(checkA.odds);
  const freshB = Number(checkB.odds);
  const inverseSum = 1 / freshA + 1 / freshB;
  const freshProfit = (1 - inverseSum) * 100;
  if (freshA !== Number((legA as any).odds) || freshB !== Number((legB as any).odds)) {
    steps.push(`Cotes recalculées : ${bookA} ${(legA as any).odds} → ${freshA} / ${bookB} ${(legB as any).odds} → ${freshB} — marge réelle ${freshProfit.toFixed(2)}%`);
  }
  if (inverseSum >= 1) {
    return {
      ok: false, stage: "verify", steps, plan, sessions, odds,
      reason: `Cotes recalculées (${bookA} ${freshA} / ${bookB} ${freshB}) : marge ${freshProfit.toFixed(2)}% — le gain n'est plus garanti, aucune mise engagée`,
    };
  }

  let finalPlan = planStakes({
    bookA, bookB, oddA: freshA, oddB: freshB,
    balanceA: Number((connA as any).balance || 0), balanceB: Number((connB as any).balance || 0),
    maxTotal: Number(maxTotal) || 0,
    maxStakeA: capWith(bookA, limA), maxStakeB: capWith(bookB, limB),
    minStakeA: limA.min, minStakeB: limB.min,
  });
  if (!finalPlan.ok) return { ok: false, stage: "stakes", reason: finalPlan.reason, plan: finalPlan, steps, sessions, odds };
  steps.push(`Contrôle final OK — mises engagées : ${bookA} ${finalPlan.stakeA} F / ${bookB} ${finalPlan.stakeB} F, profit garanti ${finalPlan.profitMin} F`);

  // ── Placement réel — les deux jambes partent simultanément, sans priorité
  const legs = [
    { book: bookA, ad: adA, conn: connA as any, selection: checkA.selection, odds: freshA, stake: finalPlan.stakeA, label: labelA },
    { book: bookB, ad: adB, conn: connB as any, selection: checkB.selection, odds: freshB, stake: finalPlan.stakeB, label: labelB },
  ];

  // Minimum propre au MARCHÉ (Congobet impose un montant de base par marché).
  const tooSmall = legs.filter((l) => l.selection?.minStake && l.stake < Number(l.selection.minStake));
  if (tooSmall.length) {
    return {
      ok: false, stage: "stakes", plan: finalPlan, steps, sessions, odds,
      reason: tooSmall.map((l) => `${l.book} exige au moins ${l.selection.minStake} F sur ce marché (mise calculée ${l.stake} F) — aucune mise engagée`).join(" · "),
    };
  }

  // Toutes les vérifications sont passées (liquidité, sélections retrouvées,
  // marchés ouverts, cotes fraîches relues, marge recalculée, minimums par
  // marché).
  //
  // ── PLACEMENT : LA JAMBE LA PLUS FRAGILE D'ABORD ──────────────────────
  // Le départ simultané des deux jambes était la CAUSE MÉCANIQUE des positions
  // à découvert (18 découverts sur 37 placements réels, mesuré le 19/08/2026) :
  // 1win accepte presque toujours, BetMomo/Congobet/betPawa refusent presque
  // toujours. Partir ensemble revenait donc à engager 1win seul à chaque fois.
  //
  // On pose maintenant D'ABORD la jambe la plus susceptible d'être refusée
  // (classement mesuré dans placementOrder.ts) et on ne pose la seconde QUE si
  // la première est réellement confirmée. Si la fragile refuse : RIEN n'est
  // engagé, zéro exposition.
  //
  // Juste avant, les deux sélections sont relues EN PARALLÈLE : si l'une des
  // deux est déjà fermée, on n'engage RIEN du tout — zéro exposition.
  const coupons: Record<string, any> = { [bookA]: opp.leg_a_coupon || null, [bookB]: opp.leg_b_coupon || null };

  const rechecks = await Promise.all(legs.map((l) =>
    cachedResolve(l.book, l.ad, opp, coupons[l.book], opp[l.ad.matchIdField], l.label, 0, { host: l.conn?.host })
      .catch((e: any) => ({ ok: false, reason: String(e?.message || e) })),
  ));

  const closed = legs
    .map((l, i) => (!(rechecks[i] as any)?.ok ? { book: l.book, reason: (rechecks[i] as any)?.reason || "indisponible" } : null))
    .filter(Boolean) as { book: string; reason: string }[];

  if (closed.length) {
    steps.push(`${closed.map((c) => c.book).join(" et ")} : marché fermé au dernier contrôle — aucune mise engagée`);
    return {
      ok: false, stage: "placement", placed: [], plan: finalPlan, steps, sessions, odds,
      unusable_books: closed.map((c) => c.book),
      reason: `${closed.map((c) => `${c.book} — ${c.reason}`).join(" · ")} : aucune mise engagée, zéro exposition`,
    };
  }

  // Sélections rafraîchies au dernier contrôle.
  legs.forEach((l, i) => { l.selection = (rechecks[i] as any).selection; });

  // ── SÉLECTION DÉJÀ DÉCLARÉE INJOUABLE ? ────────────────────────────────
  // Une sélection que le bookmaker vient de refuser comme hors ligne le reste
  // en général plusieurs minutes, tout en continuant d'afficher sa cote. On
  // rejouait donc la même sélection condamnée encore et encore (159 refus
  // betPawa relevés sur un même identifiant), à ~27 s perdues par tentative.
  // On abandonne maintenant tout de suite : le temps repart vers les
  // opportunités réellement jouables. Zéro exposition.
  const dead = legs.filter((l) => isOffline(l.book, selectionIdOf(l.selection)));
  if (dead.length) {
    steps.push(`${dead.map((l) => l.book).join(" et ")} : sélection refusée hors ligne il y a moins de ${Math.round(OFFLINE_TTL_MS / 1000)} s — tentative abandonnée sans attendre`);
    return {
      ok: false, stage: "placement", placed: [], plan: finalPlan, steps, sessions, odds,
      unusable_books: dead.map((l) => l.book),
      reason: `${dead.map((l) => `${l.book} — sélection non jouable (refusée hors ligne récemment)`).join(" · ")} : aucune mise engagée`,
    };
  }

  // ── Ultime contrôle de marge sur les cotes de cette dernière lecture ──
  // Les cotes de ce contrôle étaient lues puis IGNORÉES : une baisse survenue
  // juste avant la pose passait inaperçue et le pari partait sans marge.
  const lastA = Number((rechecks[legs.findIndex((l) => l.book === bookA)] as any).odds);
  const lastB = Number((rechecks[legs.findIndex((l) => l.book === bookB)] as any).odds);
  if (lastA > 1 && lastB > 1) {
    const lastSum = 1 / lastA + 1 / lastB;
    if (lastSum >= 1) {
      steps.push(`Dernière lecture avant pose : ${bookA} ${lastA} / ${bookB} ${lastB} — marge ${((1 - lastSum) * 100).toFixed(2)}%`);
      return {
        ok: false, stage: "verify", placed: [], plan: finalPlan, steps, sessions, odds,
        reason: `La cote a bougé juste avant la pose (${bookA} ${lastA} / ${bookB} ${lastB}) : le gain n'est plus garanti — aucune mise engagée`,
      };
    }
  }

  // ── LIVE : MISES RECALCULÉES SUR CETTE DERNIÈRE LECTURE ────────────────
  // Le contrôle final ayant été fusionné, les mises avaient été calculées sur
  // les cotes de l'examen initial. En live elles doivent suivre les cotes de
  // l'instant : c'est cette lecture-ci qui sert de référence à la pose.
  if (isLive && lastA > 1 && lastB > 1 && (lastA !== freshA || lastB !== freshB)) {
    const livePlan = planStakes({
      bookA, bookB, oddA: lastA, oddB: lastB,
      balanceA: Number((connA as any).balance || 0), balanceB: Number((connB as any).balance || 0),
      maxTotal: Number(maxTotal) || 0,
      maxStakeA: capWith(bookA, limA), maxStakeB: capWith(bookB, limB),
    minStakeA: limA.min, minStakeB: limB.min,
    });
    if (!livePlan.ok) return { ok: false, stage: "stakes", reason: livePlan.reason, plan: livePlan, steps, sessions, odds };
    finalPlan = livePlan;
    legs.forEach((l) => {
      l.odds = l.book === bookA ? lastA : lastB;
      l.stake = l.book === bookA ? livePlan.stakeA : livePlan.stakeB;
    });
    steps.push(`Live : mises réajustées sur les cotes d'avant-pose (${bookA} ${lastA} / ${bookB} ${lastB}) — ${bookA} ${livePlan.stakeA} F / ${bookB} ${livePlan.stakeB} F`);
  }

  // ── POSE SIMULTANÉE DES DEUX JAMBES ────────────────────────────────────
  // Les deux mises partent EN MÊME TEMPS. La pose séquentielle « fragile
  // d'abord » ajoutait un aller-retour complet entre les deux jambes : en
  // direct, la sélection partait hors ligne pendant ce délai — c'est la cause
  // n°1 des refus betPawa (105 abandons sur une seule journée).
  //
  // Ce qui protège l'argent n'est plus l'ordre, mais la COTE PLANCHER envoyée
  // avec chaque mise : en dessous de total_engagé / mise_de_la_jambe, le
  // bookmaker refuse lui-même le pari. Une re-tarification à la baisse ne peut
  // donc pas créer de position perdante, même sans attendre l'autre jambe.
  // Si malgré tout une seule jambe passe, la couverture immédiate (plus bas)
  // reprend la main.
  const engagedTotal = legs.reduce((s, x) => s + Number(x.stake || 0), 0);
  for (const l of legs) {
    if (Number(l.stake) > 0 && engagedTotal > 0) {
      l.selection = { ...l.selection, minOdds: Number((engagedTotal / Number(l.stake)).toFixed(4)) };
    }
  }
  // ── VALIDATION À BLANC AVANT LE PREMIER FRANC ENGAGÉ ───────────────────
  // Ce qu'aucun ordre de pose ne peut protéger, c'est la jambe posée EN DERNIER :
  // quand elle refuse, l'autre est déjà engagée. Mesuré sur les 400 dernières
  // tentatives, TOUS les découverts restants étaient exactement cela — 1win, le
  // bookmaker qui accepte le plus (donc posé en dernier, et engagé dans 348 675 F
  // des 360 550 F exposés), refusant pour un motif invisible d'avance :
  // « sélection refusée » ou « maximum autorisé 0 ».
  //
  // Les bookmakers capables de valider un coupon SANS mise sont donc interrogés
  // avant toute pose. Un refus annoncé ici annule le pari entier : zéro franc
  // engagé, zéro position à découvert. Une réponse peu claire ne bloque rien
  // (comportement inchangé), mais elle est tracée dans le déroulé.
  const preflights = await Promise.all(legs.map(async (l) => {
    if (!l.ad.preflight || !(Number(l.stake) > 0)) return null;
    const v = await l.ad.preflight(l.conn, l.selection, Number(l.stake))
      .catch((e: any) => ({ state: "unknown" as const, reason: String(e?.message || e) }));
    return { book: l.book, ...v };
  }));
  const refusedAhead = preflights.find((v) => v?.state === "refused");
  if (refusedAhead) {
    steps.push(`Validation à blanc ${refusedAhead.book} : REFUS annoncé (${refusedAhead.reason}) — pari annulé avant toute mise`);
    const learned = await learnFromRefusal(refusedAhead.book, opp.market_family, isLiveOpp, refusedAhead.reason).catch(() => ({} as any));
    if (learned?.max) steps.push(`Retenu : ${refusedAhead.book} plafonne ce marché à ${learned.max} F`);
    if (learned?.min) steps.push(`Retenu : ${refusedAhead.book} exige au moins ${learned.min} F`);
    return {
      ok: false, stage: "verify", placed: [], plan: finalPlan, steps, sessions, odds,
      unusable_books: [refusedAhead.book],
      reason: `${refusedAhead.reason} — détecté AVANT la pose : aucune mise engagée, aucune position à découvert`,
    };
  }
  for (const v of preflights) {
    if (!v) continue;
    steps.push(v.state === "ok"
      ? `Validation à blanc ${v.book} : mise de ${legs.find((l) => l.book === v.book)?.stake} F acceptable ✅`
      : `Validation à blanc ${v.book} : sans réponse claire (${v.reason}) — cette jambe passera en premier`);
  }

  // ── PLAFOND NON VÉRIFIABLE ⇒ JAMBE À POSER EN PREMIER ──────────────────
  // Constat du 16/09/2026 : les trois découverts pré-match de la nuit (19 500 F,
  // 20 000 F et 19 500 F engagés seuls sur 1xBet) suivent tous le MÊME chemin.
  // 1win est réputé fiable, il est donc posé en dernier ; sa validation à blanc
  // ne renvoie AUCUNE borne (« unknown ») parce que la passerelle ne publie pas
  // de plafond pour ces sélections ; on posait quand même ; et 1win refusait
  // ensuite avec « maximum autorisé 0 » — un plafond qu'il refusait justement
  // d'annoncer d'avance. Sa réputation de fiabilité ne valait donc rien sur ces
  // sélections-là.
  // Règle : tant qu'un bookmaker n'a pas CONFIRMÉ qu'il accepte la mise, il est
  // traité comme la jambe fragile et part seul en premier. S'il refuse, plus un
  // franc n'est engagé nulle part.
  // Un bookmaker incapable de valider un coupon à blanc (betPawa, 1xBet,
  // Congobet, Apollo, BetMomo, YellowBet) est lui aussi « non confirmé » : il
  // passe donc devant celui qui a, lui, confirmé accepter la mise.
  // ⚠️ 18/09/2026 — CAUSE DES 4 DÉCOUVERTS PRÉ-MATCH « 1win : maximum autorisé 0 »
  // (65 000 F engagés seuls sur 1xBet, compte gbossouhdodji). Déroulé identique
  // à chaque fois : la validation à blanc 1win répond « aucune borne renvoyée »
  // (sa passerelle ne publie AUCUN plafond : elle renvoie un résultat vide),
  // 1win passait donc quand même en second au nom de sa fiabilité, puis
  // refusait avec max_bet_amount = 0 → 1xBet nu.
  // Or 1xBet, lui, annonce le plafond exact de la sélection AVANT la mise
  // (lecture ci-dessus) : son motif de refus principal est donc déjà écarté.
  // Un book dont le plafond réel a été lu compte donc comme « acceptation
  // vérifiée » : c'est l'autre, invérifiable, qui part seul en premier. S'il
  // refuse, plus un franc n'est engagé nulle part.
  const confirmed = new Set([
    ...preflights.filter((v) => v?.state === "ok").map((v) => v!.book),
    ...maxVerified,
  ]);
  const unverified = new Set(legs.map((l) => l.book).filter((b) => !confirmed.has(b)));
  // ⚠️ RÈGLE « VALIDATION À BLANC INDÉTERMINÉE = PRIORITÉ ABSOLUE » RETIRÉE
  // le 17/09/2026 au soir. Elle faisait passer 1win AVANT YellowBet et betPawa
  // dès que sa validation à blanc ne renvoyait aucune borne — c'est-à-dire
  // presque toujours. Or ces deux books n'ont AUCUNE validation à blanc et sont
  // les plus refusés (« Live time delay not met », « FOB_ODDS_CHANGED ») : 1win
  // partait donc seul, confirmait, puis l'autre refusait → 1win à découvert
  // (trois positions nues dans l'après-midi, 950 F, 1 000 F et 950 F engagés).
  // Le classement qui décide est de nouveau le RISQUE DE REFUS MESURÉ ; la
  // validation à blanc ne sert qu'à DÉCLASSER un book qui a confirmé accepter
  // la mise, jamais à en promouvoir un autre.

  // ── DERNIÈRE LECTURE DU SOLDE AVANT LE PREMIER FRANC ENGAGÉ ────────────
  // Le solde de la connexion peut avoir plusieurs minutes (une autre mise du
  // même compte est partie entre-temps). Il est donc redemandé maintenant : un
  // compte qui ne couvre plus sa jambe annule le pari entier. Voir
  // shared/prePlaceBalance.ts.
  const balCheck = await verifyBalancesBeforePlacing(legs);
  steps.push(...balCheck.steps);
  if (!balCheck.ok) {
    return {
      ok: false, stage: "liquidity", placed: [], plan: finalPlan, steps, sessions, odds,
      unusable_books: balCheck.books || [],
      reason: balCheck.reason || "Solde insuffisant au dernier contrôle — aucune mise engagée",
    };
  }

  // ── LIVE : LA JAMBE FRAGILE D'ABORD, l'autre SEULEMENT si elle confirme ─
  // En direct, 1xBet ET betPawa sont les jambes les plus souvent refusées (cote
  // re-tarifée, sélection suspendue ou hors ligne à la seconde). Partir ensemble
  // revenait à engager régulièrement l'autre book seul → position à découvert.
  //
  // INCIDENT DU 14/09/2026 : un même surebet live (tennis, total jeux 1er set,
  // betPawa 3.40 / 1win 1.68) a mis 8 comptes à découvert en une minute. La
  // sélection betPawa était HORS LIGNE (FOB_OFFLINE_PRICES, online:false,
  // newPrice:0) alors que son flux public affichait toujours 3.40 : betPawa a
  // refusé les 8 fois, et comme les deux jambes partaient ensemble, 1win était
  // déjà engagé seul à chaque fois (jusqu'à 62 500 F). betPawa rejoint donc
  // 1xBet : il part en premier, et si son refus tombe, la seconde mise n'est
  // même pas envoyée — zéro exposition.
  // La liste figée « 1xBet / betPawa d'abord » laissait 72 tentatives live sans
  // aucune protection (1win + BetMomo, 1win + Apollo, 1win + Congobet : books
  // qui refusent 9 fois sur 10, posés EN MÊME TEMPS que 1win qui accepte
  // presque toujours → 1win engagé seul). L'ordre suit donc désormais le risque
  // de refus mesuré, en live comme en pré-match : le book fragile part seul en
  // premier. Un book stable n'est jamais pénalisé — il passe simplement en
  // second, et c'est précisément ce qui l'empêche de rester à découvert.
  const place = (l: any, stake: number) => l.ad.place(l.conn, l.selection, stake)
    .catch((e: any) => ({ success: false, error: String(e?.message || e) }));

  // ── PRÉ-MATCH : TOUJOURS SÉQUENTIEL, LA JAMBE FRAGILE D'ABORD ──────────
  // La pose simultanée n'a de justification qu'en direct, où la seconde d'écart
  // tue la cote. En pré-match les cotes sont stables : partir ensemble n'apporte
  // RIEN et coûte cher. Mesuré sur les 400 dernières tentatives : 3 découverts
  // pré-match totalisant 234 500 F engagés à nu — 65 % de tout l'argent exposé —
  // parce que 1win acceptait 101 500 F pendant que 1xBet refusait au motif
  // « la mise maximum est 19 100 ₣ ». Posée en premier, la jambe fragile refuse
  // AVANT que le moindre franc ne soit engagé.
  // Pose TOUJOURS séquentielle, la jambe la plus fragile seule en premier :
  // c'est la seule disposition où un refus ne peut engager aucun argent. Le
  // départ simultané ne protégeait rien, il ne faisait que gagner une seconde.
  const ordered = orderLegs(legs, isLive);
  // Le book le plus risqué part en premier ; s'il a CONFIRMÉ accepter la mise,
  // c'est l'autre — celui qui n'a rien confirmé — qui passe devant lui.
  // ⚠️ DÉCOUVERT DU 17/09/2026, 19h43 (YellowBet 950 F / 1win) — le book qui
  // n'avait « pas confirmé accepter la mise » (1win) passait devant YellowBet.
  // Or YellowBet ne confirme sa mise live qu'après un second appel, 8 s plus
  // tard, qui peut être refusé : 1win partait donc AVANT le seul refus encore
  // possible, et restait nu. Un book à confirmation différée en direct garde
  // toujours la première place, même face à un book non confirmé.
  const firstLocked = isLive && mustGoFirstLive(ordered[0].book, true);
  const fragile = (!firstLocked && ordered.find((l) => unverified.has(l.book))) || ordered[0];
  if (firstLocked && unverified.size && ordered[1] && unverified.has(ordered[1].book)) {
    steps.push(`${ordered[0].book} confirme sa mise live en différé : il part en premier malgré la non-confirmation de ${ordered[1].book} — aucune mise ne partira avant son ticket`);
  }
  if (unverified.has(fragile.book) && fragile.book !== ordered[0].book) {
    steps.push(`${fragile.book} n'a pas confirmé accepter la mise : il passe en premier malgré sa fiabilité habituelle — aucune autre mise ne partira sans sa confirmation`);
  }
  const xi = legs.findIndex((l) => l.book === fragile.book);
  let results: any[];

  if (xi >= 0) {
    const oi = xi === 0 ? 1 : 0;
    const risky = legs[xi].book;
    steps.push(`${isLive ? "Live" : "Pré-match"} : ${risky} posé en premier (${legs[xi].stake} F, cote plancher ${legs[xi].selection?.minOdds}) — ${legs[oi].book} ne partira que si ${risky} confirme`);
    const first: any = await place(legs[xi], legs[xi].stake);
    results = [];
    results[xi] = first;
    if (first?.success) {
      // ── PREMIÈRE JAMBE PARTIELLE OU RE-TARIFÉE : LA SECONDE SUIT ─────────
      // Incident du 24/09/2026 : 1win n'a pris que 2 625 F sur 3 100 F, puis
      // betPawa a quand même reçu les 9 500 F prévus → position perdante si 1win
      // gagne. La seconde mise est donc recalculée sur ce que la première a
      // RÉELLEMENT engagé (montant et cote du ticket), jamais sur le plan.
      const gotStake = Number(first.acceptedStake) > 0 ? Number(first.acceptedStake) : Number(legs[xi].stake);
      const gotOdd = Number(first.appliedOdds) > 1 ? Number(first.appliedOdds) : Number(legs[xi].odds);
      if (gotStake < Number(legs[xi].stake) || gotOdd !== Number(legs[xi].odds)) {
        const minB = Math.max(minStakeOf(legs[oi].book), Number((oi === 0 ? limA : limB).min) || 0);
        const balanced = Math.round((gotStake * gotOdd) / Number(legs[oi].odds) / 10) * 10;
        const next = Math.min(Number(legs[oi].stake), Math.max(minB, balanced));
        first.balancedBySecond = true;
        steps.push(`${risky} a engagé ${gotStake} F à ${gotOdd} (demandé ${legs[xi].stake} F à ${legs[xi].odds}) — mise ${legs[oi].book} ramenée de ${legs[oi].stake} F à ${next} F pour garder l'équilibre`);
        legs[oi].stake = next;
        // Cote plancher recalculée sur le nouveau total réellement engagé.
        legs[oi].selection = { ...legs[oi].selection, minOdds: Number(((gotStake + next) / next).toFixed(4)) };
      }
      // ── COTE RE-TARIFÉE QUI CASSE LE SUREBET (06/10/2026) ──────────────
      // 1win a accepté 4 100 F à 1,80 au lieu de 2,36 : équilibrer la seconde
      // jambe à la cote prévue verrouillait une perte (−1 720 F) annoncée
      // « sécurisée ». La seconde jambe passe donc par la couverture : gain
      // garanti recherché d'abord sur la cote du moment, sauvetage ensuite.
      const otherOdd = Number(legs[oi].odds);
      if (gotOdd < Number(legs[xi].odds) && otherOdd > 1 && (1 / gotOdd + 1 / otherOdd) >= 1) {
        steps.push(`${risky} a re-tarifé la cote à ${gotOdd} (prévu ${legs[xi].odds}) : avec ${legs[oi].book} à ${otherOdd} il n'y a plus de gain garanti — la seconde jambe passe par la couverture au lieu d'être posée à perte`);
        results[oi] = { success: false, definitive: true, repriced: true, stake: legs[oi].stake, error: `cote re-tarifée par ${risky} (${gotOdd} au lieu de ${legs[xi].odds}) — plus de gain garanti à ${otherOdd}` };
      } else {
        steps.push(`${risky} confirmé — pose de ${legs[oi].book} ${legs[oi].stake} F`);
        results[oi] = await place(legs[oi], legs[oi].stake);
      }
    } else {
      steps.push(`${risky} n'a pas confirmé — ${legs[oi].book} non tentée, aucune mise à découvert`);
      results[oi] = { success: false, skipped: true, error: `non tentée — ${risky} n'a pas confirmé (${first?.error || "refus"})` };
    }
  } else {
    steps.push(`Pose simultanée : ${legs.map((l) => `${l.book} ${l.stake} F (cote plancher ${l.selection?.minOdds})`).join(" + ")}`);
    results = await Promise.all(legs.map((l) => place(l, l.stake)));
  }

  const placed: any[] = legs.map((l, i) => {
    const res: any = results[i];
    steps.push(`${l.book} : ${res?.success ? `pari confirmé ✅${res.ticketId ? ` (ticket ${res.ticketId})` : ""}` : `échec (${res?.error})`}`);
    if (!res?.success && isUnplayableRefusal(res?.error, res?.detail)) {
      markOffline(l.book, selectionIdOf(l.selection));
      steps.push(`${l.book} : sélection mise de côté ${Math.round(OFFLINE_TTL_MS / 1000)} s — le temps qu'elle revienne en ligne`);
    }
    return {
      book: l.book, ...res,
      requestedStake: l.stake,
      requestedOdds: l.odds,
      stake: Number(res?.acceptedStake) > 0 ? Number(res.acceptedStake) : l.stake,
    };
  });

  // ── CE QUE LE BOOKMAKER VIENT DE NOUS APPRENDRE ────────────────────────
  // Un refus chiffré (« la mise maximum est 19 100 ₣ », « minimum 300 ») et une
  // mise partiellement acceptée sont les SEULS endroits où le bookmaker dit sa
  // vraie limite. On la retient pour tous les comptes : le prochain calcul de
  // mises restera dans ces bornes, donc plus de jambe refusée pour ce motif.
  await Promise.all((placed as any[]).map(async (p) => {
    if (p.skipped || p.repriced) return;
    if (!p.success) {
      const learned = await learnFromRefusal(p.book, opp.market_family, isLiveOpp, p.error);
      if (learned.max) steps.push(`Retenu : ${p.book} plafonne ce marché à ${learned.max} F — appliqué dès la prochaine mise`);
      if (learned.min) steps.push(`Retenu : ${p.book} exige au moins ${learned.min} F sur ce marché`);
      return;
    }
    const cap = await learnFromPartial(p.book, opp.market_family, isLiveOpp, p.requestedStake, p.stake);
    if (cap) steps.push(`Retenu : ${p.book} n'accepte que ${cap} F sur ce marché`);
  }));

  // ── DERNIÈRE JAMBE PLAFONNÉE : COMPLÉMENT IMMÉDIAT ─────────────────────
  // Un bookmaker peut n'accepter qu'une PARTIE de la mise (limite de gain sur le
  // marché) sans rien signaler. Sur la jambe posée en premier, le moteur s'en
  // sort : il redimensionne la seconde. Sur la DERNIÈRE, plus rien ne vient
  // après elle — l'équilibre reste rompu et la position devient perdante
  // (mesuré au banc : −122 F sur 1 300 F engagés, soit −9 %).
  // On repose donc UNE fois le complément manquant sur la MÊME sélection. Ce
  // n'est pas un nouveau pari : c'est la fin de celui-ci. Uniquement quand le
  // bookmaker a explicitement chiffré ce qu'il a accepté — jamais sur une
  // réponse ambiguë, sans quoi on risquerait de parier deux fois.
  // Avec la pose simultanée, N'IMPORTE LAQUELLE des deux jambes peut être
  // plafonnée : le complément est donc tenté sur chacune, pas seulement sur la
  // dernière posée.
  if ((placed as any[]).every((p) => p.success)) {
    for (const capped of (placed as any[])) {
      const manque = Math.floor(Number(capped.requestedStake) - Number(capped.stake));
      // Seconde jambe déjà recalibrée sur ce montant : un complément romprait l'équilibre.
      if (manque <= 0 || capped.balancedBySecond) continue;
      const l = legs.find((x) => x.book === capped.book)!;
      steps.push(`${capped.book} n'a accepté que ${capped.stake} F sur ${capped.requestedStake} F — complément de ${manque} F reposé sur la même sélection`);
      const top: any = await l.ad.place(l.conn, l.selection, manque)
        .catch((e: any) => ({ success: false, error: String(e?.message || e) }));
      const ajout = top?.success ? (Number(top.acceptedStake) > 0 ? Number(top.acceptedStake) : manque) : 0;
      if (ajout > 0) {
        capped.stake = Number(capped.stake) + ajout;
        capped.topUpStake = ajout;
        l.stake = capped.stake;
        steps.push(`Complément accepté ✅ ${ajout} F — mise totale ${capped.book} : ${capped.stake} F, équilibre rétabli`);
      } else {
        steps.push(`Complément refusé (${top?.error || "inconnu"}) — la mise ${capped.book} reste plafonnée à ${capped.stake} F`);
      }
    }
  }

  let refused = (placed as any[]).filter((p) => !p.success);

  // ── Refus AMBIGU : on ne repose JAMAIS par-dessus ──────────────────────
  // « OperationInProgress », « aucun numéro de ticket », coupure réseau : le
  // bookmaker n'a pas dit non, il n'a pas confirmé. La mise peut être passée
  // chez lui. Reposer reviendrait à parier deux fois du même côté.
  // Même règle qu'au rattrapage (exposureCover.ts) : c'est le TEXTE du refus qui
  // tranche. Un motif de refus CERTAIN (« Live time delay not met », « Bet type
  // odd was not found in event data » chez YellowBet : solde vérifié inchangé)
  // ne doit jamais être classé ambigu à cause d'un drapeau posé plus haut —
  // sinon la couverture immédiate est sautée et la jambe adverse reste nue.
  const ambiguous = refused.filter((p) => !isExplicitRefusal(p.error) && (p.ambiguous || isAmbiguousRefusal(p.error)));
  if (ambiguous.length) {
    const accepted = (placed as any[]).filter((p) => p.success);
    steps.push(`${ambiguous.map((p) => p.book).join(", ")} n'a pas confirmé (réponse ambiguë) — aucune reprise tentée pour ne pas parier deux fois du même côté`);
    return {
      ok: false, stage: "placement", placed, plan: finalPlan, steps, sessions, odds,
      unusable_books: ambiguous.map((p) => p.book),
      reason: `${ambiguous.map((p) => `${p.book} — réponse non confirmée (${p.error})`).join(" · ")} : vérifiez à la main si ce pari est passé chez ${ambiguous.map((p) => p.book).join(", ")}${accepted.length ? `, la jambe ${accepted.map((p) => `${p.book} (${p.stake} F)`).join(", ")} est engagée` : " — aucune autre mise engagée"}`,
    };
  }

  // ── Jambe refusée alors que l'autre est passée : COUVERTURE IMMÉDIATE ──
  // Cas de la mise à découvert. La MISE de couverture est recalculée sur la cote
  // réelle du moment (hedgeStake.ts) : une cote qui a bougé n'annule plus le
  // rattrapage, elle change seulement le montant à poser. On ne repose que si la
  // position redevient sans perte.
  let recoveredTotal = finalPlan.total;
  let recoveredProfit = finalPlan.profitMin;

  if (refused.length === 1 && (placed as any[]).some((p) => p.success)) {
    const bad = refused[0];
    const badLeg = legs.find((l) => l.book === bad.book)!;
    const engaged = (placed as any[]).find((p) => p.success)!;
    const engagedLeg = legs.find((l) => l.book === engaged.book)!;
    const engagedOdd = Number(engaged.appliedOdds) > 1 ? Number(engaged.appliedOdds) : Number(engaged.requestedOdds) || Number(engagedLeg.odds);
    const engagedStake = Number(engaged.stake);

    // ── LE PLAFOND PAR PARI NE BRIDE PLUS UNE COUVERTURE ────────────────
    // Le plafond réglé par l'utilisateur (1 000 F par pari) sert à limiter le
    // RISQUE PRIS sur un nouveau pari. Appliqué à une couverture, il produit
    // l'inverse de son but : le 18/09/2026, couvrir 1 000 F engagés demandait
    // 1 031 F ; le plafond a refusé les 31 F de trop, et la jambe est restée nue
    // — 1 000 F risqués à 100 % pour avoir refusé d'en engager 1 031. Couvrir
    // n'ajoute pas de risque, il le referme. Seules deux bornes subsistent donc
    // ici : la liquidité réelle du compte, et le plafond propre au bookmaker.
    const badLim = badLeg.book === bookA ? limA : limB;
    const coverCap = Number(badLim.max) || null;
    if (Number(capOf(badLeg.book)) > 0) {
      steps.push(`Couverture : plafond de ${capOf(badLeg.book)} F par pari levé — seule la liquidité du compte borne la mise (une jambe à découvert coûte plus cher qu'un dépassement de plafond)`);
    }

    // Deux temps : d'abord le gain garanti (le marché verrouillé se rouvre
    // souvent en 20-90 s), puis — en direct seulement, où attendre revient à
    // laisser la mise à nu — le SAUVETAGE : la mise qui plafonne la perte.
    // Deux temps EN DIRECT COMME EN PRÉ-MATCH : d'abord le gain garanti, puis le
    // sauvetage (mise qui plafonne la perte). Le sauvetage était réservé au
    // direct : les trois découverts pré-match du 16/09 (19 500 F, 20 000 F et
    // 19 500 F engagés seuls sur betPawa, 1win refusant « maximum autorisé 0 »)
    // n'ont donc JAMAIS eu de seconde chance — la position est restée nue alors
    // qu'une mise de plafonnement était possible. Un match non commencé
    // n'expose pas moins d'argent qu'un match en cours.
    for (const bestEffort of [false, true]) {
      if (bestEffort) steps.push("Aucun gain garanti retrouvé — sauvetage immédiat : mise qui plafonne la perte au lieu de laisser la jambe à nu");

      const cover = await coverRefusedLeg({
        ad: badLeg.ad, conn: badLeg.conn, opp, label: badLeg.label,
        coupon: badLeg.book === bookA ? (opp.leg_a_coupon || null) : (opp.leg_b_coupon || null),
        engagedStake, engagedOdd,
        book: badLeg.book,
        maxStake: coverCap,
        minStake: badLim.min,
        bestEffort,
        // Cote fermée à la seconde (odd_closed, sélection suspendue) : reposer
        // immédiatement se fait refuser à l'identique. Constaté à la main : 20-30 s
        // et la cote revient, parfois meilleure. On attend donc avant la reprise.
        firstWaitMs: isTemporaryBlock(bad.error, bad.detail) ? 22000 : 0,
      });
      steps.push(...cover.steps);
      if (cover.ambiguous) {
        Object.assign(bad, cover.placement, { stake: cover.stake, ambiguous: true });
        return { ok: false, stage: "placement", placed, plan: finalPlan, steps, sessions, odds,
          unusable_books: [bad.book], reason: "Couverture non confirmée — vérification du ticket nécessaire, aucune autre mise envoyée" };
      }
      if (cover.covered) {
        Object.assign(bad, {
          stake: cover.stake ?? badLeg.stake, coverOdd: cover.odds,
          ...(cover.placement as any), recovered: true,
        });
        recoveredTotal = cover.total ?? recoveredTotal;
        recoveredProfit = Math.round(Math.min(engagedStake * engagedOdd, Number(bad.stake) * Number(cover.odds)) - recoveredTotal);
        refused = [];
        break;
      }

      // Le bookmaker d'origine reste inaccessible (marché verrouillé, cote
      // effondrée) → on cherche la MÊME sélection chez un autre bookmaker
      // connecté. Là aussi, aucun plafond par pari : la couverture d'abord.
      const elsewhere = await coverElsewhere({
        opp, refusedBook: bad.book, engagedBook: engaged.book,
        label: badLeg.label, engagedStake, engagedOdd,
        maxStakes: {}, credentials, bestEffort,
      });
      steps.push(...elsewhere.steps);
      if (elsewhere.ambiguous) {
        Object.assign(bad, elsewhere.placement, { origBook: badLeg.book, book: elsewhere.book, stake: elsewhere.stake, ambiguous: true });
        return { ok: false, stage: "placement", placed, plan: finalPlan, steps, sessions, odds,
          unusable_books: [bad.book], reason: "Couverture de repli non confirmée — aucune autre mise avant vérification du ticket" };
      }
      if (elsewhere.covered) {
        Object.assign(bad, {
          origBook: badLeg.book,
          book: elsewhere.book, stake: elsewhere.stake ?? badLeg.stake, coverOdd: elsewhere.odds,
          ...(elsewhere.placement as any), recovered: true, covered_elsewhere: true,
        });
        recoveredTotal = elsewhere.total ?? recoveredTotal;
        recoveredProfit = Math.round(Math.min(engagedStake * engagedOdd, Number(bad.stake) * Number(elsewhere.odds)) - recoveredTotal);
        refused = [];
        break;
      }
    }
  }

  if (refused.length) {
    const accepted = (placed as any[]).filter((p) => p.success);
    // Dernier filet : rachat (cash-out) de la jambe restée seule chez 1win / betPawa
    if (accepted.length === 1) {
      const acc = accepted[0];
      const accLeg = legs.find((l) => l.book === acc.book);
      const co = await cashoutExposedLeg(acc.book, accLeg?.conn, String(acc.ticketId || "")).catch((e: any) => ({ ok: false, reason: String(e) }));
      steps.push(co.ok ? `Cash-out ${acc.book} : ${co.amount} F rendus sur ${acc.stake} F — plus aucune position à découvert` : `Cash-out ${acc.book} impossible (${co.reason})`);
      if (co.ok) {
        Object.assign(acc, { cashout: true, cashout_amount: co.amount });
        return {
          ok: false, stage: "placement", placed, plan: finalPlan, steps, sessions, odds, cashed_out: true,
          unusable_books: refused.filter((p) => !p.skipped).map((p) => p.book),
          reason: `Pari refusé chez ${refused.map((p) => p.book).join(", ")} — jambe ${acc.book} rachetée (cash-out ${co.amount} F sur ${acc.stake} F), aucune position à découvert`,
        };
      }
    }
    return {
      ok: false, stage: "placement", placed, plan: finalPlan, steps, sessions, odds,
      unusable_books: refused.filter((p) => !p.skipped).map((p) => p.book),
      reason: accepted.length
        ? `Pari refusé chez ${refused.map((p) => p.book).join(", ")} — la jambe ${accepted.map((p) => `${p.book} (${p.stake} F)`).join(", ")} est à découvert, à couvrir à la main`
        : `Pari refusé chez ${refused.map((p) => p.book).join(", ")} — aucune mise engagée`,
    };
  }

  // `origBook` : présent quand la jambe a été couverte chez un AUTRE bookmaker.
  const ticketA = (placed as any[]).find((p) => (p.origBook || p.book) === bookA);
  const ticketB = (placed as any[]).find((p) => (p.origBook || p.book) === bookB);
  // Cote de chaque jambe, par ordre de vérité décroissante :
  //  1. celle réellement appliquée par le bookmaker sur le ticket,
  //  2. celle de la couverture si la jambe a été rattrapée,
  //  3. la cote lue juste avant la pose.
  const realOdd = (t: any, fallback: number) =>
    Number(t?.appliedOdds) > 1 ? Number(t.appliedOdds) : Number(t?.coverOdd) || fallback;
  const oddA = realOdd(ticketA, Number(ticketA?.requestedOdds) || freshA);
  const oddB = realOdd(ticketB, Number(ticketB?.requestedOdds) || freshB);
  const stakeA = Number(ticketA?.stake) || finalPlan.stakeA;
  const stakeB = Number(ticketB?.stake) || finalPlan.stakeB;
  // Bénéfice recalculé sur ce qui est RÉELLEMENT parti — jamais sur le plan.
  const realTotal = stakeA + stakeB;
  const realProfit = Math.round(Math.min(stakeA * oddA, stakeB * oddB) - realTotal);
  if (realProfit !== recoveredProfit) {
    steps.push(`Bénéfice recalculé sur les cotes réellement enregistrées (${bookA} ${oddA} / ${bookB} ${oddB}) : ${realProfit >= 0 ? "+" : ""}${realProfit} F au lieu de ${recoveredProfit} F annoncés`);
  }
  recoveredTotal = realTotal;
  recoveredProfit = realProfit;

  const ticket = {
    match: opp.match_label,
    market: opp.market_family,
    sport: opp.sport || "football",
    team_home: opp.team_home || "",
    team_away: opp.team_away || "",
    kickoff_iso: opp.kickoff_iso || null,
    is_live: !!opp.is_live,
    status: "validated",
    placed_at: new Date().toISOString(),
    time: new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
    currency: (connA as any).currency || "FCFA",
    netProfit: recoveredProfit,
    totalStake: recoveredTotal,
    // Une jambe rattrapée porte sa mise et sa cote RÉELLES (recalculées) : le
    // ticket doit refléter ce qui est parti, pas le plan initial.
    legA: {
      book: ticketA?.book || bookA, label: opp.leg_a_label,
      odd: oddA, stake: stakeA,
      ticketId: ticketA?.ticketId ?? null,
    },
    legB: {
      book: ticketB?.book || bookB, label: opp.leg_b_label,
      odd: oddB, stake: stakeB,
      ticketId: ticketB?.ticketId ?? null,
    },
  };

  return {
    ok: true, dry_run: false, stage: "placed",
    // Le motif doit nommer la VRAIE cause quand le pari finit en perte : une
    // cote re-tarifée et une mise plafonnée par le bookmaker n'appellent pas le
    // même réglage côté utilisateur (annonçer « cote re-tarifée » sur un
    // plafonnement de mise envoyait sur une fausse piste).
    reason: recoveredProfit >= 0
      ? `Pari confirmé sur ${bookA} et ${bookB} (cotes enregistrées ${oddA} / ${oddB}) — bénéfice net garanti +${recoveredProfit} ${ticket.currency}`
      : `Pari confirmé sur ${bookA} et ${bookB} mais ${
        (placed as any[]).some((p) => Number(p.requestedStake) > Number(p.stake))
          ? `le bookmaker n'a accepté qu'une partie de la mise (${(placed as any[]).filter((p) => Number(p.requestedStake) > Number(p.stake)).map((p) => `${p.book} ${p.stake} F sur ${p.requestedStake} F`).join(", ")})`
          : `la cote a été re-tarifée à la pose (${oddA} / ${oddB})`
      } : perte plafonnée à ${Math.abs(recoveredProfit)} ${ticket.currency}`,
    ticket, placed, plan: finalPlan, steps, liquidity, sessions, odds,
  };
}