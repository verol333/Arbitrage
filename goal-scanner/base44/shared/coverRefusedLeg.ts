// ═══════════════════════════════════════════════════════════════════
// COUVERTURE D'URGENCE D'UNE JAMBE REFUSÉE.
//
// Une jambe est acceptée, l'autre refusée par le bookmaker : le compte est
// EXPOSÉ — une mise engagée sans contrepartie.
//
// Ce module tente de reposer la jambe manquante. Il ne se contente PLUS de
// vérifier que la cote est restée assez haute pour la mise prévue au départ :
// à chaque essai, il relit la cote réelle et RECALCULE la mise nécessaire
// (voir hedgeStake.ts) pour récupérer au minimum le total engagé. Une cote qui
// baisse n'est donc plus un abandon : c'est une mise à ajuster, dans la limite
// du solde et du plafond de l'utilisateur.
//
// Si même en recalculant la position ne peut pas redevenir sans perte, on ne
// repose rien — jamais de mise à l'aveugle, jamais d'aggravation.
// ═══════════════════════════════════════════════════════════════════

import { computeHedgeStake } from "./hedgeStake.ts";
import { isAmbiguousRefusal } from "./placementOrder.ts";
import { learnFromRefusal } from "./bookStakeLimits.ts";

// Une cote bloquée / un marché verrouillé se rouvre en général au bout de
// quelques dizaines de secondes. On insiste pendant ~1 min 30, ce qui laisse le
// temps au bookmaker de rouvrir le marché avant de rendre la main.
const MAX_RETRIES = 6;
const RETRY_WAIT_MS = 15000;

/**
 * Refus DÉFINITIF sur ce bookmaker : réessayer n'y changera rien (fonds
 * insuffisants, mise sous le minimum / au-dessus du maximum). Inutile d'attendre
 * 90 s — on rend la main tout de suite pour tenter le repli chez un autre book.
 */
function isNonRetryable(error: unknown): boolean {
  const t = String(error ?? "").toLowerCase();
  return /fonds insuffisants|not_enough_funds|insufficient|minimum autoris|min_bet|maximum autoris|max_bet|sous le minimum|au-dessus du maximum/.test(t);
}

/**
 * Plafond de mise ANNONCÉ par le bookmaker dans son refus
 * (« La mise maximum est 19100 ₣ », « au-dessus du maximum autorisé (19100 max) »).
 *
 * Ce plafond dépend du marché et n'est connu qu'au moment du refus. Avant, un tel
 * refus était classé « définitif » et la jambe engagée restait à découvert en
 * TOTALITÉ (constaté le 14/09/2026 : 101 500 F à nu alors que 19 100 F étaient
 * acceptables). On relit donc le chiffre pour reposer la mise au plafond permis :
 * une couverture partielle vaut toujours mieux qu'aucune.
 */
export function parseBookMaxStake(error: unknown): number | null {
  const t = String(error ?? "");
  const m = t.match(/(?:mise maximum est|maximum autoris[^\d]{0,20}|max(?:imum)?[^\d]{0,10})([\d\s.,]{2,15})/i);
  if (!m) return null;
  const n = Number(String(m[1]).replace(/[\s.,](?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export interface CoverResult {
  covered: boolean;
  ambiguous?: boolean;
  /** Réponse du bookmaker si la jambe a finalement été posée */
  placement?: Record<string, unknown>;
  /** Cote réellement obtenue à la reprise */
  odds?: number;
  /** Mise réellement engagée (recalculée sur la cote du moment) */
  stake?: number;
  /** Total engagé sur l'opération après couverture */
  total?: number;
  /** Résultat du pire cas (négatif = perte plafonnée en mode sauvetage) */
  worstCase?: number;
  steps: string[];
}

export interface CoverOpts {
  /** adaptateur du bookmaker refusé (resolve + place) */
  ad: any;
  /** session déjà ouverte sur ce bookmaker */
  conn: any;
  /** opportunité d'origine */
  opp: Record<string, any>;
  /** libellé de la sélection de cette jambe */
  label: string;
  /** données de coupon de cette jambe */
  coupon: Record<string, unknown> | null;
  /** mise déjà partie sur la jambe acceptée */
  engagedStake: number;
  /** cote de la jambe déjà partie */
  engagedOdd: number;
  /** plafond de mise configuré par l'utilisateur sur ce bookmaker */
  maxStake?: number | null;
  /** plancher réel déjà constaté chez ce bookmaker sur ce marché */
  minStake?: number | null;
  /** nom du bookmaker — sert à MÉMORISER les limites qu'il annonce en refusant */
  book?: string;
  /**
   * Mode SAUVETAGE : la recherche de gain garanti a déjà échoué partout et
   * l'exposition dure. On accepte alors la mise qui PLAFONNE la perte plutôt
   * que de laisser la jambe engagée à nu (perte de 100 % de la mise).
   */
  bestEffort?: boolean;
  /** Nombre d'essais (le mode sauvetage n'attend pas : il agit tout de suite). */
  attempts?: number;
  /**
   * Pause AVANT la première reprise. Sert quand le refus vient d'un blocage
   * momentané de la cote (voir isTemporaryBlock) : reposer dans la seconde ne
   * peut que se faire refuser à nouveau, il faut laisser le bookmaker rouvrir.
   */
  firstWaitMs?: number;
}

/**
 * Le refus dit-il « cette cote est momentanément bloquée » plutôt que non ?
 * Constaté à la main le 17/09/2026 : une cote 1win fermée (odd_closed) est
 * revenue au bout de 20-30 s, et à un prix MEILLEUR. Ces refus ne doivent donc
 * pas être rejoués tout de suite, mais ils ne doivent pas non plus faire
 * abandonner : on attend, puis on repose.
 */
export function isTemporaryBlock(error: unknown, detail?: unknown): boolean {
  const t = `${String(error ?? "")} ${typeof detail === "object" && detail ? JSON.stringify(detail) : ""}`.toLowerCase();
  return /odd_closed|odd_blocked|offline|suspend|verrouill|locked|momentan|vient d'être fermée/.test(t);
}

/** Tente de couvrir la jambe refusée en recalculant la mise à chaque essai. */
export async function coverRefusedLeg(opts: CoverOpts): Promise<CoverResult> {
  const { ad, conn, opp, label, coupon, engagedStake, engagedOdd, maxStake = null, minStake = 0, bestEffort = false } = opts;
  const tries = Number(opts.attempts) > 0 ? Number(opts.attempts) : (bestEffort ? 2 : MAX_RETRIES);
  const steps: string[] = [];
  // Solde utilisable : 95 % du solde lu, pour absorber frais et arrondis.
  const balance = conn?.balance === null || conn?.balance === undefined
    ? null
    : Math.floor(Number(conn.balance) * 0.95);

  // Plafond effectif : celui de l'utilisateur, abaissé si le bookmaker annonce
  // le sien dans un refus. `capForced` bascule alors en couverture partielle.
  let cap: number | null = maxStake;
  let capForced = false;

  // Cote bloquée à l'instant du refus : on laisse au bookmaker le temps de la
  // rouvrir avant la première reprise (20-30 s suffisent en pratique).
  const firstWait = Number(opts.firstWaitMs) || 0;
  if (firstWait > 0 && !bestEffort) {
    steps.push(`Cote momentanément bloquée — attente de ${Math.round(firstWait / 1000)} s avant la première reprise`);
    await new Promise((r) => setTimeout(r, firstWait));
  }

  // ⚠️ 22/09/2026 — LES REPRISES IDENTIQUES CONSOMMAIENT LA FENÊTRE DE SECOURS.
  // Relevé sur les découverts du 18 et du 21/09 : SIX reprises d'affilée avec
  // exactement le même motif (« sélection non identifiable — ligne déplacée »,
  // « sélection hors ligne »), soit 90 s perdues, puis les bookmakers de repli
  // n'étaient sollicités qu'une fois les cotes envolées. Un motif qui se répète
  // à l'identique et qui n'est pas un blocage momentané est DÉFINITIF : on rend
  // la main immédiatement pour couvrir ailleurs, tant que le marché existe.
  let lastFail = "";
  const stopIfRepeated = (motif: unknown): boolean => {
    const sig = String(motif ?? "").slice(0, 160);
    if (sig && sig === lastFail && !isTemporaryBlock(sig)) {
      steps.push("Motif de refus identique à la reprise précédente — inutile d'insister, passage immédiat au repli chez un autre bookmaker");
      return true;
    }
    lastFail = sig;
    return false;
  };

  for (let attempt = 1; attempt <= tries; attempt++) {
    const fresh = await ad
      // `host` = site du pays du compte (betPawa) : la reprise doit relire la
      // cote là où la mise partira, sinon on couvre sur un prix inexistant.
      .resolve(opp, coupon, opp[ad.matchIdField], label, { host: conn?.host })
      .catch((e: any) => ({ ok: false, reason: String(e?.message || e) }));

    if (!fresh?.ok) {
      steps.push(`Reprise ${attempt}/${tries} — sélection indisponible (${fresh?.reason || "illisible"})`);
      if (stopIfRepeated(fresh?.reason)) break;
    } else {
      const odds = Number(fresh.odds);
      const hedge = computeHedgeStake({
        engagedStake, engagedOdd, coverOdds: odds,
        balance, maxStake: cap,
        // Plancher : le plus contraignant entre celui du marché et celui déjà
        // constaté au refus chez ce bookmaker.
        minStake: Math.max(Number(fresh.selection?.minStake) || 0, Number(minStake) || 0),
        bestEffort: bestEffort || capForced,
      });

      if (!hedge.ok) {
        steps.push(`Reprise ${attempt}/${tries} — ${hedge.reason} : rien reposé`);
      } else {
        steps.push(`Reprise ${attempt}/${tries} — ${hedge.reason}`);
        const res = await ad.place(conn, fresh.selection, hedge.stake).catch((e: any) => ({ success: false, error: String(e?.message || e) }));
        if (res?.success) {
          steps.push(`Jambe couverte en reprise ✅ ${hedge.stake} F à la cote ${odds}${res.ticketId ? ` (ticket ${res.ticketId})` : ""}`);
          return { covered: true, placement: res, odds, stake: hedge.stake, total: hedge.total, worstCase: hedge.worstCase, steps };
        }
        steps.push(`Reprise ${attempt}/${tries} — refus à nouveau (${res?.error || "inconnu"})`);
        // `definitive` : le bookmaker a nommé son motif ET rien n'est engagé
        // (solde vérifié). Un tel refus ne doit jamais passer pour ambigu, sinon
        // la reprise s'arrête net et la jambe adverse reste à découvert.
        if (!res?.definitive && (res?.ambiguous || isAmbiguousRefusal(res?.error))) {
          steps.push("Résultat de couverture indéterminé — aucune répétition ni repli ailleurs avant vérification du ticket");
          return { covered: false, ambiguous: true, placement: res, stake: hedge.stake, odds, steps };
        }
        // Plafond de marché annoncé par le bookmaker : on repose aussitôt au
        // montant permis (couverture partielle) au lieu d'abandonner la jambe.
        // Ce que ce refus nous apprend est retenu pour tous les comptes : la
        // prochaine mise sur ce marché restera d'emblée dans ces bornes.
        if (opts.book) await learnFromRefusal(opts.book, opp.market_family, !!opp.is_live, res?.error).catch(() => null);
        const bookMax = parseBookMaxStake(res?.error);
        if (bookMax && bookMax < hedge.stake && (!cap || bookMax < cap)) {
          cap = bookMax;
          capForced = true;
          steps.push(`${bookMax} F est le plafond du bookmaker sur ce marché — nouvelle tentative à ce montant (couverture partielle)`);
          continue;
        }
        // ⚠️ 01/10/2026 — 1win RETIENT la mise pendant sa validation live, puis
        // la rend quand il répond « cote fermée ». Une reprise lancée avant ce
        // remboursement voit un solde vide et lit « fonds insuffisants » : ce
        // n'est pas un vrai manque d'argent. On laisse le remboursement arriver.
        const heldFunds = /fonds insuffisants/i.test(String(res?.error || "")) && /odd_closed/i.test(lastFail);
        if (heldFunds && attempt < tries) {
          steps.push("Solde encore retenu par le refus précédent — attente du remboursement (12 s) puis nouvelle reprise");
          await new Promise((r) => setTimeout(r, 12_000));
          continue;
        }
        if (isNonRetryable(res?.error)) {
          steps.push("Refus définitif sur ce bookmaker (fonds / limites de mise) — passage immédiat au repli ailleurs");
          break;
        }
        if (stopIfRepeated(res?.error)) break;
      }
    }

    if (attempt < tries) await new Promise((r) => setTimeout(r, RETRY_WAIT_MS));
  }

  return { covered: false, steps };
}