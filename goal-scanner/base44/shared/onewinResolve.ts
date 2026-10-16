// ═══════════════════════════════════════════════════════════════════
// 1WIN — lecture des cotes FRAÎCHES et résolution exacte de la sélection.
//
// Les cotes 1win ne sont pas servies en REST : elles arrivent par WebSocket
// (push-server-v2 de la passerelle top-parser). On s'abonne au match, on prend
// l'instantané des groupes de cotes, puis on identifie la sélection à jouer.
//
// Une sélection 1win se place avec { oddId, cf (cote), matchId } — c'est ce que
// renvoie resolveOnewinSelection, avec la cote lue à l'instant même.
// Champs réels d'une cote : { id, cf, name, outcome, status, vars:{ v1 } }.
// status !== 1 = sélection suspendue → jamais jouable.
// ═══════════════════════════════════════════════════════════════════

import { groupMatcher, isDnbFamily, isFavourableLine, isHandicapGroup, norm, selectionLine, teamTotalSide, wantedOutcome } from "./onewinMarketMap.ts";
import { sideByTeamName, sideOfSelection } from "./legAudit.ts";
import { sameTeam } from "./teamMatch.ts";

/**
 * 1win traduit parfois le nom (« Amiral » pour « Admiral »). Le match n'a que DEUX
 * groupes « <équipe> total » : si l'un est sans aucun doute l'ADVERSAIRE, l'autre
 * est le nôtre. Dans tout autre cas on s'abstient.
 */
export function teamTotalByElimination(names: string[], family: string, teams?: { home?: string; away?: string }): string | undefined {
  const side = teamTotalSide(family);
  if (!side || !teams?.home || !teams?.away || /\b(1mt|2mt|mi-temps|q[1-4]|set|periode|period|half)\b/i.test(family)) return undefined;
  const ours = side === "home" ? teams.home : teams.away;
  const other = side === "home" ? teams.away : teams.home;
  const cands = names
    .map((g) => ({ g, m: norm(g).match(/^(.+?) total( \(inc ot\))?$/) }))
    .filter((x) => x.m && !/[.:]|\b(period|periode|half|mi-temps|quarter|quart|set)\b/.test(x.m[1]));
  if (cands.length !== 2) return undefined;
  const isOther = cands.map((x) => sameTeam(x.m![1], other) && !sameTeam(x.m![1], ours));
  if (isOther.filter(Boolean).length !== 1) return undefined;
  return cands[isOther.indexOf(false)].g;
}

const PLATFORM = "44ba10e5-7df2-47ab-a44d-dc93803c7a6e";
const wsUrl = (lang: string) => `wss://api-gateway.top-parser.com/push-server-v2/?Language=${lang}&externalPartnerId=${PLATFORM}&EIO=4&transport=websocket`;

export type OnewinOddsGroups = Record<string, any[]>;

// L'instantané arrive en plusieurs trames : on attend un vrai silence du flux
// (quietMs) avant de considérer la liste des marchés comme complète.
// `lang` permet de relire le flux dans la langue du scanner (en-001) à des fins de diagnostic.
export function fetchOnewinOdds(
  matchId: number | string,
  timeoutMs = 20000,
  quietMs = 5000,
  lang = "fr-CI",
  // ⚠️ LATENCE MESURÉE LE 12/09/2026 : 8,3 s en moyenne (jusqu'à 20 s) rien que
  // pour cette lecture, parce qu'on attendait 5 s de silence complet du flux.
  // Pendant ce temps la cote bougeait et l'arbitrage disparaissait (6 abandons
  // « plus d'arbitrage sur les cotes fraîches »). Dès que le marché cherché est
  // arrivé, il n'y a plus rien à attendre : on rend la main immédiatement.
  readyWhen?: (groups: OnewinOddsGroups) => boolean,
): Promise<OnewinOddsGroups> {
  const id = Number(matchId);
  const WS_URL = wsUrl(lang);
  const groups: OnewinOddsGroups = {};
  return new Promise((resolve) => {
    let settled = false, started = false, phase = 0, lastUpdate = Date.now();
    let ws: WebSocket;
    let watchdog: number | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (watchdog) clearInterval(watchdog);
      clearTimeout(hard);
      try { ws.close(); } catch (_e) { /* déjà fermé */ }
      resolve(groups);
    };
    const hard = setTimeout(finish, timeoutMs);
    try { ws = new WebSocket(WS_URL); } catch (_e) { clearTimeout(hard); resolve(groups); return; }

    ws.onmessage = (event) => {
      const msg = typeof event.data === "string" ? event.data : "";
      if (msg.startsWith("0") && phase === 0) { ws.send("40"); phase = 1; return; }
      if (msg.startsWith("40") && phase <= 1) {
        phase = 2;
        ws.send("42" + JSON.stringify(["subscribe", { messageType: "subscribe-match-odds", data: { matchIds: [id], isBaseOddsGroups: false } }]));
        watchdog = setInterval(() => { if (started && Date.now() - lastUpdate > quietMs) finish(); }, 400);
        return;
      }
      if (msg === "2") { ws.send("3"); return; }
      if (!msg.startsWith("42")) return;
      try {
        const payload = JSON.parse(msg.slice(2));
        const body = Array.isArray(payload) ? payload[1] : null;
        if (!body?.messageType?.startsWith("match-odds")) return;
        if (Number(body.data?.matchId) !== id) return;
        for (const g of body.data?.oddsGroups || []) {
          if (g?.name && Array.isArray(g.oddsList) && g.oddsList.length) {
            const byId = new Map((groups[g.name] || []).map((o: any) => [String(o.id), o]));
            for (const o of g.oddsList) byId.set(String(o.id), o);
            groups[g.name] = [...byId.values()];
          }
        }
        started = true;
        lastUpdate = Date.now();
        if (readyWhen) { try { if (readyWhen(groups)) return finish(); } catch (_e) { /* prudence */ } }
      } catch (_e) { /* trame ignorée */ }
    };
    ws.onerror = finish;
    ws.onclose = finish;
  });
}

export interface OnewinSelectionResolved {
  oddId: string;
  cf: number;
  matchId: number;
  name: string;
  group: string;
}

type ResolveResult =
  | { ok: true; selection: OnewinSelectionResolved }
  | { ok: false; code: string; reason: string };

/** Camps reconnus dans le vocabulaire `outcome` de 1win. */
const KNOWN_SIDES = ["1", "2", "x", "1x", "x2", "12", "over", "under", "yes", "no"];

/**
 * CAMP D'UNE SÉLECTION DANS LE GROUPE « DOUBLE CHANCE ».
 *
 * ⚠️ CAUSE RÉELLE MESURÉE LE 17/09/2026 (Blooming vs Universitario de Vinto) :
 * 1win TRADUIT les noms d'équipe (« Blooming » servi « Épanouissement »). La
 * sélection « Épanouissement Ou Universitaire de Vinto » — c'est-à-dire « 12 » —
 * n'était donc reconnue que par une seule équipe et lue « camp 2 » : la jambe
 * « Un gagnant (12) » était déclarée non identifiable et l'opportunité perdue.
 *
 * Dans ce groupe il n'y a que trois issues possibles, et le match nul suffit à
 * les séparer sans dépendre d'aucune traduction :
 *   • le nul n'est PAS cité → c'est « 12 » ;
 *   • le nul est cité → « 1X » ou « X2 » selon l'équipe nommée à côté.
 */
const isDcGroup = (groupName: string) => /double chance|chance double/.test(norm(groupName));

function dcSideOf(name: unknown, teams?: { home?: string; away?: string }): string {
  if (!/\b(nul|draw)\b/.test(norm(name))) return "12";
  const byName = sideByTeamName(name, teams);
  return byName === "1x" || byName === "x2" ? byName : "";
}

/**
 * La sélection trouvée correspond-elle VRAIMENT au camp demandé ?
 * Renvoie le libellé de la sélection fautive en cas de désaccord, sinon null.
 *
 * Deux contrôles indépendants, du plus sûr au plus prudent :
 *   1. le camp déclaré par 1win (`outcome`) contredit celui demandé ;
 *   2. une AUTRE sélection du même groupe, sur la même ligne, correspond au
 *      camp demandé — c'est donc elle qu'il fallait jouer.
 * Quand le camp demandé n'est pas déterminable, on ne bloque rien (le
 * comportement d'origine est conservé).
 */
function sideMismatch(
  hit: any,
  list: any[],
  marketFamily: string,
  label: string,
  teams?: { home?: string; away?: string },
  groupName?: string,
): string | null {
  const wanted = wantedOutcome(label, teams, marketFamily);
  if (!wanted) return null;

  // Groupe « Double chance » : le nul tranche, la traduction du nom d'équipe
  // n'entre pas en jeu (voir dcSideOf).
  if (groupName && isDcGroup(groupName)) {
    const got = dcSideOf(hit?.name, teams);
    return !got || got === wanted ? null : String(hit?.name || got);
  }

  // ⚠️ L'ORDRE DES ÉQUIPES DIFFÈRE D'UN BOOKMAKER À L'AUTRE : mesuré chez 1win,
  // « camp 1 » désignait l'équipe qui est à l'EXTÉRIEUR chez 1xBet. Comparer les
  // camps positionnels rejetait donc des jambes correctes. Quand le libellé de
  // la sélection nomme une équipe, ce nom tranche : il ne dépend d'aucun ordre.
  const byName = sideByTeamName(hit?.name, teams);
  if (byName) return byName === wanted ? null : String(hit?.name || byName);

  // Le camp se lit sur le libellé AUTANT que sur le champ `outcome` : 1win nomme
  // ses sélections « Au-Dessus De 56.5 » tout en servant un `outcome` d'un autre
  // vocabulaire. Ne regarder que `outcome` faisait passer des sélections
  // correctes pour un camp inconnu (ou pour le camp inverse).
  const got = sideOfSelection(hit?.name, hit?.outcome, marketFamily, teams);
  if (got && KNOWN_SIDES.includes(got) && got !== wanted) {
    return String(hit?.name || got);
  }

  const sameLine = (o: any) => String(o?.vars?.v1 ?? "") === String(hit?.vars?.v1 ?? "");
  const rightOne = list.find((o: any) =>
    String(o?.id) !== String(hit?.id) &&
    Number(o?.status) === 1 && Number(o?.cf) > 1 &&
    sameLine(o) && sideOfSelection(o?.name, o?.outcome, marketFamily, teams) === wanted,
  );
  return rightOne ? String(hit?.name || "sélection inattendue") : null;
}

/**
 * Retrouve la sélection exacte à jouer chez 1win avec sa cote de l'instant.
 * Échoue explicitement si le marché est fermé, suspendu, ou si la sélection
 * n'est pas identifiable sans ambiguïté — dans ce cas l'opportunité est
 * ignorée (jamais de pari approximatif).
 */
export async function resolveOnewinSelection(
  matchId: number | string,
  marketFamily: string,
  label: string,
  teams?: { home?: string; away?: string },
  oddId?: string,
): Promise<ResolveResult> {
  const matches = groupMatcher(marketFamily, teams, label);
  // Le marché visé est arrivé (ou l'identifiant exact du scanner) → on n'attend
  // pas le reste du flux : chaque seconde gagnée est une cote encore valable.
  const ready = (g: OnewinOddsGroups) => Object.entries(g).some(([name, list]) =>
    (oddId && (list || []).some((o: any) => String(o?.id) === String(oddId))) ||
    (matches(name) && (list || []).some((o: any) => Number(o?.status) === 1 && Number(o?.cf) > 1)));
  const groups = await fetchOnewinOdds(matchId, 20000, 5000, "fr-CI", ready);
  const names = Object.keys(groups);
  // BASE FACTUELLE DU REFUS : la cote exacte repérée par le scanner est-elle
  // encore servie par 1win ? Sans cette information, un refus « sélection non
  // identifiable » ne dit pas s'il s'agit d'un vocabulaire mal reconnu (bug de
  // notre côté) ou d'une ligne qui a réellement disparu du flux (rien à
  // corriger). Vérifié le 12/09/2026 : sur un handicap −4.5, l'identifiant du
  // scanner était bel et bien absent et 1win n'offrait plus que ±3.5.
  const idSeen = oddId
    ? Object.values(groups).some((l) => (l || []).some((o: any) => String(o?.id) === String(oddId)))
    : null;
  const basis = idSeen === false
    ? " — la cote exacte repérée par le scanner n'existe plus dans le flux 1win (ligne déplacée ou marché retiré)"
    : "";
  if (!names.length) {
    return { ok: false, code: "no_odds", reason: "1win : aucune cote reçue pour ce match (marché fermé ou match terminé)" };
  }

  // ── VOIE EXACTE : l'identifiant de sélection lu par le scanner ──
  // Le scanner enregistre l'oddId 1win exact de la cote détectée. On le
  // retrouve dans le flux de l'instant : identification certaine (aucune
  // interprétation de libellé) et cote FRAÎCHE. On ne l'utilise que s'il
  // existe réellement dans le flux et que la sélection est ouverte.
  if (oddId) {
    for (const [groupName, list] of Object.entries(groups)) {
      const hit = (list || []).find((o: any) => String(o.id) === String(oddId));
      if (!hit) continue;
      if (Number(hit.status) !== 1 || !(Number(hit.cf) > 1)) {
        return { ok: false, code: "market_unavailable", reason: `1win : sélection « ${label} » suspendue à l'instant — opportunité ignorée` };
      }
      // ⚠️ CONTRÔLE DE CAMP — INCIDENT DU 22/08/2026.
      // L'identifiant fourni par le scanner était joué SANS AUCUN contrôle.
      // Sur un « Remboursé si match nul », l'identifiant désignait en réalité
      // l'équipe adverse : le même camp a été joué chez les DEUX bookmakers
      // (double mise du même côté au lieu d'un arbitrage). On vérifie donc que
      // la sélection trouvée est bien celle demandée avant d'engager quoi que
      // ce soit — au moindre désaccord, l'opportunité est abandonnée.
      // Le groupe qui porte l'identifiant doit être celui de la famille demandée
      // (un identifiant de « Résultat 1X2 » ne peut pas servir un DNB).
      const familyMatches = groupMatcher(marketFamily, teams, label);
      // Le contrôle d'unité (buts / corners / cartons…) est désormais porté par
      // groupMatcher : un « Corners Total » ne peut plus être servi par le total
      // de buts, et le vrai marché de corners n'est plus écarté à tort.
      const wrongGroup = !familyMatches(groupName);
      const mismatch = wrongGroup ? `${groupName} (mauvais marché)` : sideMismatch(hit, list || [], marketFamily, label, teams, groupName);
      if (mismatch) {
        // L'identifiant du scanner désigne le mauvais camp. Au lieu d'abandonner
        // l'opportunité, on repasse par la recherche par libellé ci-dessous :
        // elle exige camp ET ligne confirmés, donc aucun risque de jouer deux
        // fois le même côté — et la jambe redevient jouable.
        console.log(`[onewinResolve] identifiant écarté (désigne « ${mismatch} », attendu « ${label} ») — recherche par libellé`);
        break;
      }
      return {
        ok: true,
        selection: {
          oddId: String(hit.id),
          cf: Number(hit.cf),
          matchId: Number(matchId),
          name: String(hit.name || ""),
          group: groupName,
        },
      };
    }
  }

  const groupName = names.find((n) => matches(n)) || teamTotalByElimination(names, marketFamily, teams);
  if (!groupName) {
    return { ok: false, code: "market_unavailable", reason: `1win : marché « ${marketFamily} » absent du match (${names.length} marchés ouverts : ${names.slice(0, 6).join(", ")})${basis} — opportunité ignorée` };
  }

  const wanted = wantedOutcome(label, teams, marketFamily);
  // Total d'une équipe : « −0.5 » désigne le côté (moins de), pas une ligne négative.
  const rawLine = selectionLine(label);
  // DNB joué via le groupe « Handicap » : seule la ligne 0 est un vrai DNB.
  const dnbViaHandicap = isDnbFamily(marketFamily) && isHandicapGroup(groupName);
  const wantLine = dnbViaHandicap ? 0
    : teamTotalSide(marketFamily) && rawLine !== null ? Math.abs(rawLine) : rawLine;

  const playable = (groups[groupName] || []).filter((o) => Number(o.cf) > 1 && Number(o.status) === 1);
  if (!playable.length) {
    return { ok: false, code: "market_unavailable", reason: `1win : marché « ${marketFamily} » suspendu à l'instant — opportunité ignorée` };
  }

  const dcGroup = isDcGroup(groupName);
  const scored = playable
    .map((o) => {
      // Camp de la sélection lu sur le LIBELLÉ ET sur `outcome`. Auparavant seul
      // `outcome` était comparé au camp demandé : sur les totaux de joueur
      // (« Total 1 » / « Total 2 » au tennis de table), 1win n'y met pas
      // « over »/« under », donc TOUTE sélection était pénalisée et le marché
      // déclaré « introuvable » alors que la bonne cote était dans la liste.
      const oc = dcGroup ? dcSideOf(o.name, teams) : sideOfSelection(o.name, o.outcome, marketFamily, teams);
      const oLine = o.vars?.v1 != null ? Number(o.vars.v1) : selectionLine(o.name);
      let score = 0;
      // Le nom d'équipe prime sur le camp positionnel (ordre inversé possible).
      // Dans une double chance, le nom d'équipe seul ne prouve rien : c'est le
      // nul (présent ou absent) qui désigne l'issue — d'où la lecture ci-dessus.
      const byTeam = dcGroup ? "" : sideByTeamName(o.name, teams);
      if (wanted && byTeam) score += byTeam === wanted ? 60 : -100;
      else if (wanted && oc === wanted) score += 60;
      else if (wanted && oc) score -= 100;
      // Nom identique = identification certaine (cas des libellés d'équipe).
      if (norm(o.name) === norm(label)) score += 70;
      if (wantLine !== null) {
        if (oLine === null) score -= 60;
        else if (Math.abs(oLine - wantLine) < 0.001) score += 60;
        // Ligne décalée EN NOTRE FAVEUR : acceptée en second choix (la ligne
        // exacte gagne toujours si elle existe). Une ligne plus dure reste
        // refusée. La marge est recalculée ensuite sur la cote réelle.
        else if (isFavourableLine(oLine, wantLine, wanted, marketFamily)) score += 25;
        else score -= 100;
      }
      return { o, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  // Seuil strict : sans côté ET ligne confirmés, on refuse de jouer.
  if (!best || best.score < 60) {
    // TRAÇABILITÉ : sans le détail de ce que 1win a réellement servi, un refus
    // « non identifiable » est indéboguable. On joint les meilleurs candidats
    // (libellé, camp lu, ligne lue) directement au motif : il atterrit dans le
    // journal des tentatives et montre immédiatement quel vocabulaire manque.
    const seen = scored.slice(0, 4).map(({ o, score }) => {
      const side = (dcGroup ? dcSideOf(o.name, teams) : sideOfSelection(o.name, o.outcome, marketFamily, teams)) || "camp illisible";
      const line = o.vars?.v1 != null ? Number(o.vars.v1) : selectionLine(o.name);
      return `« ${String(o.name || "?")} » [${side}${line === null ? "" : ` · ligne ${line}`} · ${score}]`;
    }).join(", ");
    return {
      ok: false,
      code: "selection_not_found",
      reason: `1win : sélection « ${label} » non identifiable dans « ${groupName} » (camp attendu « ${wanted || "?"} »${wantLine === null ? "" : `, ligne ${wantLine}`})${basis} — candidats vus : ${seen || "aucun"} — opportunité ignorée`,
    };
  }
  const bestOddId = String(best.o.id || "");
  if (!bestOddId) return { ok: false, code: "no_selection_id", reason: "1win : identifiant de sélection absent" };

  return {
    ok: true,
    selection: {
      oddId: bestOddId,
      cf: Number(best.o.cf),
      matchId: Number(matchId),
      name: String(best.o.name || ""),
      group: groupName,
    },
  };
}