// ═══════════════════════════════════════════════════════════════════
// ADAPTATEURS BOOKMAKER — un seul endroit pour tout ce qui est propre à un book.
//
// ➕ AJOUTER UN BOOKMAKER = ajouter UNE entrée dans ADAPTERS ci-dessous :
//    {
//      matchIdField : champ de l'opportunité qui porte son ID de match
//      connect(cred) : → { ok, token, balance, currency, ...extra }
//      resolve(opp, coupon, matchId, label) : → { ok, odds, selection }
//      place(conn, selection, stake) : → { success, ... }
//    }
// Le moteur (placeArbitrageBet.ts) ne connaît QUE ces trois fonctions :
// aucune autre ligne de code n'est à toucher pour brancher un book de plus.
// ═══════════════════════════════════════════════════════════════════

import { loginCongobet, placeCongobetBet } from "./congobetBetting.ts";
import { resolveCongobetSelection } from "./congobetResolve.ts";
import { loginApollo, placeApolloBet } from "./apolloBetting.ts";
import { resolveApolloSelection } from "./apolloResolve.ts";
import { checkOnewinCoupon, getOnewinBalance, loginOnewin, placeOnewinBet } from "./onewinBetting.ts";
import { loginOnewinWithCaptcha } from "./onewinLogin.ts";
import { settleOnewinAmbiguity } from "./onewinVerdict.ts";
import { resolveOnewinSelection } from "./onewinResolve.ts";
import { findOnewinMatchId } from "./onewinFindMatch.ts";
import { resolveOnexbetSelection } from "./onexbetResolve.ts";
import { getMobileBalance, placeOnexbetMobileBet, getMobileCoef, userIdFromToken } from "./onexbetMobileApi.ts";
import { renewXbetFor } from "./xbetRenewHook.ts";
import { loginBetpawa, placeBetpawaBet } from "./betpawaBetting.ts";
import { resolveBetpawaSelection } from "./betpawaResolve.ts";
import { findBetpawaEventId } from "./betpawaFindEvent.ts";
import { placeBetmomoBet, restoreBetmomo } from "./betmomoBetting.ts";
import { resolveBetmomoSelection } from "./betmomoResolve.ts";
import { loginYellowbetToken } from "./yellowbetBetting.ts";
import { loginYellowbetJina, placeYellowbetJina, readYellowbetOdds } from "./yellowbetJina.ts";
import { secrets } from "base44:runtime";
import { auditSelection } from "./legAudit.ts";
import onexbetPlacement from "./onexbetPlacement.ts";
import { readOnexbetMaxBet } from "./onexbetMaxBet.ts";

export type Cred = { login?: string; password?: string; token?: string; cookies?: string; xhd?: string };
export type ConnectResult =
  | { ok: true; token: string; balance: number | null; currency: string; [k: string]: any }
  | { ok: false; reason: string; session?: unknown };
export type ResolveResult =
  | { ok: true; odds: number; selection: any }
  | { ok: false; code: string; reason: string };

export interface BookAdapter {
  matchIdField: string;
  /** (Obsolète) Ancien système de priorité de placement — supprimé : tous les
   *  bookmakers sont désormais traités à égalité, placés dans l'ordre naturel
   *  (legA puis legB). Le champ reste pour compatibilité mais n'est plus lu. */
  placePriority?: number;
  connect: (cred: Cred) => Promise<ConnectResult>;
  /**
   * `ctx` = contexte de la session qui posera le pari. Il ne sert qu'aux
   * bookmakers dont le CATALOGUE dépend du compte : betPawa a un site par pays,
   * et lire les cotes sur un autre site que celui du compte faisait déclarer
   * « match introuvable » ou « sélection hors ligne » des paris parfaitement
   * jouables. Facultatif : les autres bookmakers l'ignorent.
   */
  resolve: (opp: Record<string, any>, coupon: Record<string, any> | null, matchId: unknown, label: string, ctx?: { host?: string }) => Promise<ResolveResult>;
  place: (conn: any, selection: any, stake: number) => Promise<any>;
  /**
   * VALIDATION À BLANC (facultative) — le bookmaker dit s'il accepterait cette
   * mise, sans qu'un franc ne soit engagé. « refused » annule le pari AVANT la
   * moindre pose : c'est la seule protection possible pour la jambe posée en
   * dernier. Absente = book sans validation préalable, comportement inchangé.
   */
  preflight?: (conn: any, selection: any, stake: number) => Promise<{ state: "ok" | "refused" | "unknown"; reason?: string }>;
  /**
   * DERNIÈRE LECTURE DU SOLDE, juste avant d'engager le premier franc. Le solde
   * de la connexion peut avoir plusieurs minutes : une mise partie entre-temps
   * suffisait à faire refuser la jambe pour « fonds insuffisants », l'autre
   * jambe déjà engagée. Renvoie null si le solde n'est pas lisible (jamais 0).
   */
  readBalance?: (conn: any) => Promise<number | null>;
  /**
   * PLAFOND RÉEL DE LA SÉLECTION, annoncé par le bookmaker AVANT toute mise
   * (facultatif). Deux effets : les mises sont calculées dans cette borne, et le
   * book compte comme « acceptation vérifiée » — c'est alors l'autre jambe, la
   * non vérifiable, qui part seule en premier. Renvoie null si inconnu.
   */
  maxStake?: (conn: any, selection: any) => Promise<number | null>;
}

/**
 * Cherche un numéro de ticket dans la réponse d'un bookmaker (à n'importe quelle
 * profondeur) : id / betId / ticketId / betSlipId / couponId.
 */
function findTicketId(node: unknown, depth = 0): string | null {
  if (!node || typeof node !== "object" || depth > 4) return null;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    // ⚠️ Apollo ne renvoie PAS d'« id » : son numéro de ticket est
    // « EncryptedTicketPin ». Relevé le 15/09/2026 en posant 300 F réels : le
    // solde est passé de 1 194 à 894 F alors que notre lecture concluait
    // « aucun numéro de ticket — pari NON enregistré ». Un pari bel et bien
    // enregistré était donc compté comme refusé.
    if (/^(id|bet_?id|ticket_?id|bet_?slip_?id|coupon_?id|betslipid|encrypted_?ticket_?pin|ticket_?pin|ticket_?code)$/i.test(k) && (typeof v === "string" || typeof v === "number") && String(v).length > 0 && String(v) !== "0") {
      return String(v);
    }
    // Certains bookmakers renvoient le numéro de ticket dans un TABLEAU.
    // Congobet répond { betSystemsIds: [997347148] } : sans ce cas, un pari
    // bel et bien enregistré était compté comme refusé — et la seconde jambe,
    // non posée, laissait le premier pari à découvert. C'est exactement ce qui
    // s'est produit le 19/08/2026 sur Bayern–Stuttgart.
    if (
      /^(bet_?systems?_?ids|bet_?ids|ticket_?ids|coupon_?ids|bet_?slip_?ids)$/i.test(k) &&
      Array.isArray(v) && v.length &&
      (typeof v[0] === "string" || typeof v[0] === "number") &&
      String(v[0]).length > 0 && String(v[0]) !== "0"
    ) {
      return String(v[0]);
    }
  }
  for (const v of Object.values(node as Record<string, unknown>)) {
    const found = findTicketId(v, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * ⚠️ RÈGLE ABSOLUE : un pari n'est « confirmé » que si le bookmaker renvoie un
 * NUMÉRO DE TICKET. Une réponse HTTP 200 sans ticket (marché fermé, refus
 * silencieux, page d'erreur) est un ÉCHEC — sinon un ticket s'affiche validé
 * alors qu'une seule jambe est réellement engagée.
 */
function confirmTicket(book: string, res: any) {
  if (!res?.success) return res;
  const ticketId = res.ticketId ?? findTicketId(res.ticket);
  if (!ticketId) {
    return {
      success: false,
      error: `${book} n'a renvoyé aucun numéro de ticket — pari NON enregistré`,
      detail: typeof res.ticket === "string" ? res.ticket.slice(0, 200) : res.ticket,
      // Réponse COMPLÈTE du bookmaker : c'est elle qui permet de reconnaître,
      // book par book, un enregistrement réel derrière un message d'erreur.
      raw: res,
    };
  }
  return { ...res, ticketId };
}

const need = (matchId: unknown, book: string): ResolveResult | null =>
  matchId ? null : { ok: false, code: "no_match_id", reason: `Identifiant de match ${book} absent de l'opportunité` };

const RAW_ADAPTERS: Record<string, BookAdapter> = {
  // ── CONGOBET ──────────────────────────────────────────────────────
  congobet: {
    matchIdField: "congobet_match_id",
    // placePriority supprimé — tous les books sont placés à égalité (ordre naturel)
    async connect(cred) {
      const r = await loginCongobet(cred.login || "", cred.password || "");
      if (!r.success) return { ok: false, reason: `Connexion Congobet refusée (${r.error})` };
      return { ok: true, token: r.session.token, balance: r.session.account.balance, currency: r.session.account.currency };
    },
    async resolve(_opp, coupon, matchId) {
      const itemId = coupon?.eventBetTypeItemId;
      if (!itemId) return { ok: false, code: "no_selection_id", reason: "Identifiant de sélection Congobet absent de l'opportunité" };
      const miss = need(matchId, "Congobet"); if (miss) return miss;
      const r = await resolveCongobetSelection(matchId as string, itemId);
      if (!r.ok) return r as ResolveResult;
      return { ok: true, odds: r.selection.odds, selection: r.selection };
    },
    async place(conn, s, stake) {
      return confirmTicket("Congobet", await placeCongobetBet(conn.token, {
        totalStake: stake,
        maxPayout: Math.round(stake * s.odds),
        betLines: [{ eventId: s.eventId, eventBetTypeId: s.eventBetTypeId, eventBetTypeItemId: s.eventBetTypeItemId, fixedOdds: s.odds, stake }],
      }));
    },
  },

  // ── APOLLO ────────────────────────────────────────────────────────
  apollo: {
    matchIdField: "apollo_match_id",
    // placePriority supprimé — tous les books sont placés à égalité (ordre naturel)
    async connect(cred) {
      const r = await loginApollo(cred.login || "", cred.password || "");
      if (!r.success) return { ok: false, reason: `Connexion Apollo refusée (${r.error})` };
      return { ok: true, token: r.session.token, balance: r.session.account.balance, currency: r.session.account.currency };
    },
    async resolve(opp, _coupon, matchId, label) {
      const miss = need(matchId, "Apollo"); if (miss) return miss;
      const sel = await resolveApolloSelection(matchId as string, String(opp.market_family || ""), String(label || ""));
      if (!sel) return { ok: false, code: "market_unavailable", reason: `Apollo : marché « ${opp.market_family} / ${label} » indisponible ou suspendu à l'instant` };
      return { ok: true, odds: sel.odd, selection: sel };
    },
    async place(conn, s, stake) {
      return confirmTicket("Apollo", await placeApolloBet(conn.token, {
        payIn: stake,
        bets: [{
          BetData: s.betData, EventId: s.eventId, Odd: s.odd, Pick: s.pick, Sbv: s.sbv,
          LeagueId: s.leagueId, Game: s.gameId, PickIdentifier: s.pickIdentifier, Probability: s.probability,
        }],
      }));
    },
  },

  // ── 1WIN (session collée : le login est protégé par captcha) ───────
  "1win": {
    matchIdField: "onewin_match_id",
    // placePriority supprimé — tous les books sont placés à égalité (ordre naturel)
    async connect(cred) {
      const raw = cred.token || "";
      let r = await loginOnewin(raw, cred.cookies || "");

      // ── Reconnexion automatique par email + mot de passe ──────────────
      // Le jeton de mise 1win expire vite. Puisque l'identifiant et le mot de
      // passe sont enregistrés, on refait la connexion tout seul au lieu de
      // renoncer : plus de « session expirée » à corriger à la main, et plus
      // jamais de jambe engagée seule parce que 1win n'était plus autorisé.
      const dead = !r.success && (r.error === "token_expired" || r.error === "session_expired");
      if (dead && cred.login && cred.password) {
        const fresh = await loginOnewinWithCaptcha(cred.login, cred.password).catch(() => null);
        if (fresh?.success) r = fresh as typeof r;
      }

      if (!r.success) {
        return {
          ok: false,
          reason: r.error === "token_unavailable"
            ? "1win momentanément indisponible — reprise automatique au prochain cycle, rien à faire de votre côté"
            : r.error === "token_expired" || r.error === "session_expired"
              ? "Session 1win expirée — reconnectez votre compte 1win dans Mise Auto"
              : r.error === "captcha_required" || r.error === "captcha_invalid"
                ? "1win demande une vérification anti-robot — reconnectez-vous une fois dans Mise Auto"
                : `Connexion 1win refusée (${r.error})`,
        };
      }
      let balance = r.session.account.balance;
      if (balance === null) {
        const bal = await getOnewinBalance(cred.cookies || raw).catch(() => null);
        if (bal && bal.success) balance = bal.balance;
      }
      // `cookies` conservés : ils servent à relire le solde après une réponse
      // douteuse de la passerelle (voir onewinVerdict.ts).
      return { ok: true, token: r.session.token, balance, currency: r.session.account.currency, cookies: cred.cookies || raw };
    },
    async resolve(opp, coupon, matchId, label) {
      // Le scanner ne fournit l'identifiant 1win que si 1win faisait partie du
      // surebet. Pour un REPLI (couverture d'une jambe à découvert), on retrouve
      // le match par les noms d'équipes plutôt que de renoncer.
      if (!matchId) {
        matchId = await findOnewinMatchId(String(opp?.team_home || ""), String(opp?.team_away || "")).catch(() => null);
      }
      const miss = need(matchId, "1win"); if (miss) return { ok: false, code: "no_match_id", reason: `1win : match « ${opp?.match_label} » introuvable dans les listes du bookmaker` };
      // L'identifiant de sélection lu par le scanner est prioritaire : il
      // supprime toute interprétation de libellé (source d'opportunités
      // manquées à tort), et la cote est relue fraîche dans le flux.
      const r = await resolveOnewinSelection(matchId as string, String(opp.market_family || ""), String(label || ""), {
        home: opp.team_home, away: opp.team_away,
      }, coupon?.oddId ? String(coupon.oddId) : undefined);
      if (!r.ok) return r as ResolveResult;
      return { ok: true, odds: r.selection.cf, selection: r.selection };
    },
    async readBalance(conn) {
      const bal = await getOnewinBalance(conn.cookies || "", conn.currency).catch(() => null);
      return bal && bal.success ? Number(bal.balance) : null;
    },
    async preflight(conn, s, stake) {
      return await checkOnewinCoupon(conn.token, {
        amount: stake,
        currencyCode: conn.currency || "XAF",
        selections: [{ oddId: s.oddId, cf: s.cf, matchId: s.matchId }],
      });
    },
    async place(conn, s, stake) {
      let res: any = await placeOnewinBet(conn.token, {
        amount: stake,
        currencyCode: conn.currency || "XAF",
        selections: [{ oddId: s.oddId, cf: s.cf, matchId: s.matchId }],
      });
      // Réponse douteuse (selections_errors…) : le solde du compte tranche —
      // débité = pari passé, inchangé = refus définitif → couverture immédiate.
      if (res?.ambiguous) res = await settleOnewinAmbiguity(conn.cookies || "", conn.balance, stake, res);
      const done: any = confirmTicket("1win", res);
      // 1win peut n'accepter qu'une PARTIE de la mise (rejectedAmount) ou à une
      // autre cote que celle demandée : le ticket dit ce qui est réellement parti.
      const ok = done?.success ? res?.ticket?.result?.success : null;
      if (!ok) return done;
      return {
        ...done,
        ...(Number(ok.amount) > 0 ? { acceptedStake: Number(ok.amount) } : {}),
        ...(Number(ok.cf) > 1 ? { appliedOdds: Number(ok.cf) } : {}),
      };
    },
  },

  // ── 1XBET (API mobile UNIQUEMENT — la voie web/cookies est supprimée) ─
  // La session mobile (token JWT + app_guid) est rafraîchie automatiquement
  // toutes les 15 min côté serveur : c'est la seule voie fiable. L'ancienne
  // voie web par cookies expirait en quelques heures et générait de faux
  // « Session expirée » qui écartaient toutes les opportunités 1xBet.
  "1xbet": {
    matchIdField: "onexbet_match_id",
    async connect(cred) {
      const mobileToken = cred.token || "";
      const appGuid = cred.app_guid || cred.appGuid || "";
      if (!mobileToken || !appGuid) {
        return { ok: false, reason: "Session 1xBet mobile absente — reconnectez votre compte 1xBet dans Mise Auto" };
      }
      const userIp = cred.user_ip || cred.userIp || "";
      // ⚠️ LE SOLDE EST LU AVANT TOUTE MISE — c'est cette lecture qui plafonne
      // les mises (95 % du solde) et qui décide si la tentative a lieu.
      let token = mobileToken;
      let r = await getMobileBalance(token, appGuid, userIp);

      // Jeton refusé par 1xBet : on le régénère sur place et on relit le solde.
      // Sans cela, l'opportunité était abandonnée pour une péremption de 20 min
      // (34 abandons « Solde non disponible » relevés le 07/09/2026).
      if (!r.ok && r.authExpired) {
        const fresh = await renewXbetFor(mobileToken);
        if (fresh) {
          token = fresh;
          r = await getMobileBalance(token, appGuid, userIp);
        }
      }

      if (!r.ok) {
        return {
          ok: false,
          reason: r.error?.includes("geofencing") || r.error?.includes("157662")
            ? "1xBet bloqué par geofencing — le proxy de contournement est indisponible"
            : r.authExpired
              ? "Session 1xBet à renouveler — le jeton est refusé et n'a pas pu être régénéré, reconnectez 1xBet dans Mise Auto"
              : `1xBet mobile : ${r.error || "solde illisible"}`,
        };
      }
      return {
        ok: true, token, balance: r.balance, currency: r.currency,
        _mobile: true, _renewToken: mobileToken,
        app_guid: appGuid, user_ip: userIp,
        // ⚠️ `cred.user_uuid` contient l'e-mail du compte, pas un nombre : envoyé
        // tel quel à 1xBet il donnait « UserId: 0 » et TOUTE pose était refusée
        // (ErrorCode 304). L'identifiant numérique est lu dans le jeton.
        user_uuid: Number(cred.user_uuid) || userIdFromToken(token),
      };
    },
    async resolve(opp, coupon, matchId) {
      const r = await resolveOnexbetSelection(coupon, { home: opp?.team_home, away: opp?.team_away });
      if (!r.ok) return r as ResolveResult;
      // Use the same mobile price for planning and placement, on the EXACT
      // subgame (never the main match's identical Type/Param).
      const mobile = await getMobileCoef(r.selection.gameId, r.selection.betType, r.selection.param, r.selection.live);
      if (!(Number(mobile.coef) > 1)) return { ok: false, code: "mobile_selection_unavailable", reason: `1xBet : cote mobile indisponible (${mobile.reason || "absente"})` };
      return {
        ok: true,
        odds: Number(mobile.coef),
        selection: { ...r.selection, coef: Number(mobile.coef), mainGameId: Number(matchId) || r.selection.gameId },
      };
    },
    async maxStake(conn, s) {
      return await readOnexbetMaxBet(conn, s).catch(() => null);
    },
    async readBalance(conn) {
      const r = await getMobileBalance(conn.token, conn.app_guid, conn.user_ip).catch(() => null);
      if (r && r.ok) return Number(r.balance);
      // Jeton refusé = 1xBet ne prendra PAS le pari. Le signaler comme une
      // panne d'authentification (et non un « solde illisible ») permet
      // d'annuler le pari avant que l'autre jambe ne soit engagée — cause du
      // découvert de 19 500 F du 15/09/2026 sur Bucaspor.
      if (r && (r as any).authExpired) throw new Error("session refusée par 1xBet (jeton périmé)");
      return null;
    },
    async place(conn, s, stake) {
      const res = await onexbetPlacement(conn, s, stake, {
        readCoef: getMobileCoef, readBalance: getMobileBalance,
        renew: renewXbetFor, place: placeOnexbetMobileBet, userId: userIdFromToken,
      });
      return confirmTicket("1xBet mobile", res);
    },
  },

  // ── BETPAWA ───────────────────────────────────────────────────────
  betpawa: {
    matchIdField: "betpawa_match_id",
    // placePriority supprimé — tous les books sont placés à égalité (ordre naturel)
    async connect(cred) {
      const r = await loginBetpawa(cred.login || "", cred.password || "").catch((e: Error) => ({ success: false as const, error: e.message }));
      if (!r.success) return { ok: false, reason: r.error };
      // `host` = site betPawa du pays du compte. Les identifiants de sélection
      // sont identiques d'un pays à l'autre (vérifié), mais la MISE doit partir
      // du site où le compte existe, sinon betPawa la refuse.
      return {
        ok: true, token: r.session.token,
        balance: r.session.account.balance, currency: r.session.account.currency,
        host: r.session.host, country: r.session.countryName,
      };
    },
    async resolve(opp, coupon, matchId, label, ctx) {
      // ⚠️ TOUT SE LIT SUR LE SITE DU PAYS DU COMPTE (ctx.host) : recherche du
      // match ET lecture des cotes. Sans cela, on validait un prix ouvert au
      // Congo puis on le posait au Cameroun, où betPawa le refusait « hors
      // ligne » — le refus le plus fréquent en direct, et il venait de nous.
      const host = ctx?.host;
      // ── VOIE DIRECTE : l'identifiant de match relevé par le scanner ──────
      // CAUSE RACINE DES « MATCHS INTROUVABLES » (trouvée le 17/09/2026) : le
      // scanner CONNAÎT l'identifiant du match betPawa (il lit ses cotes avec)
      // mais ne transmettait que l'identifiant de sélection. Notre côté devait
      // donc redevinér le match par son NOM — et betPawa écrit les noms
      // autrement (paires de double réduites à un joueur, réserves, clubs
      // abrégés) : le match était déclaré « introuvable » alors qu'il était bien
      // à l'affiche. Quand l'identifiant est fourni, plus aucune devinette.
      let eventId = matchId || coupon?.eventId || await findBetpawaEventId(String(opp.team_home || ""), String(opp.team_away || ""), !!opp.is_live, undefined, host);
      // ⚠️ DOUBLES (tennis, tennis de table, beach-volley) : sur ces affiches le
      // scanner ne renseigne QU'UN joueur par camp (« Bayerlova Michaela » /
      // « A. Rogers ») alors que betPawa affiche la paire complète
      // (« Hands T / Harris B - Blanchet U / Schoolkate T »). Un camp à deux
      // joueurs ne pouvant jamais désigner un camp à un seul (garde-fou du
      // 04/09/2026), le match était déclaré introuvable indéfiniment : 17 des 54
      // abandons « match introuvable » du 13-15/09 portaient sur cette seule
      // affiche. Le libellé complet, lui, porte bien les deux paires.
      if (!eventId && / vs /i.test(String(opp.match_label || ""))) {
        const [h, a] = String(opp.match_label).split(/ vs /i);
        if (h && a && (h !== opp.team_home || a !== opp.team_away)) {
          eventId = await findBetpawaEventId(h.trim(), a.trim(), !!opp.is_live, undefined, host);
        }
      }
      if (!eventId) return { ok: false, code: "no_match_id", reason: `betPawa : match « ${opp.match_label} » introuvable dans les listes du bookmaker` };
      const r = await resolveBetpawaSelection(eventId as string, String(opp.market_family || ""), String(label || ""),
        coupon?.priceId ? String(coupon.priceId) : undefined, host);
      if (!r.ok) return r as ResolveResult;
      return { ok: true, odds: r.selection.odds, selection: r.selection };
    },
    async place(conn, s, stake) {
      return confirmTicket("betPawa", await placeBetpawaBet(conn.token, {
        stake,
        selectionIds: [s.selectionId],
        price: s.odds,
        currency: conn.currency === "FCFA" ? "XAF" : (conn.currency || "XAF"),
      }, conn.host));
    },
  },

  // ── BETMOMO (BetConstruct swarm, site 211) ────────────────────────
  betmomo: {
    matchIdField: "betmomo_match_id",
    // placePriority supprimé — tous les books sont placés à égalité (ordre naturel)
    async connect(cred) {
      // BetMomo réclame un reCAPTCHA sur le login serveur : la mise auto repose
      // donc EXCLUSIVEMENT sur la reprise de la session validée par l'utilisateur
      // lors de sa connexion (restore_login, jamais soumis au captcha). Cette
      // reprise est résiliente aux couacs réseau (voir restoreBetmomo). Un login
      // serveur par mot de passe n'aboutirait jamais ici (captcha impossible à
      // produire côté serveur) : on ne le tente pas, pour éviter le clignotement
      // « Actif ↔ Vérification… » et un faux message de captcha.
      const saved = (cred as any).token || "";
      if (!saved) {
        return { ok: false, reason: "Compte BetMomo non connecté — connectez BetMomo une fois dans Mise Auto" };
      }
      const rs = await restoreBetmomo(saved);
      if (rs.success) {
        return { ok: true, token: rs.session.token, balance: rs.session.account.balance, currency: rs.session.account.currency };
      }
      return { ok: false, reason: "Session BetMomo expirée — reconnectez votre compte BetMomo dans Mise Auto" };
    },
    async resolve(opp, _coupon, matchId, label) {
      const miss = need(matchId, "BetMomo"); if (miss) return miss;
      const r = await resolveBetmomoSelection(matchId as string, String(opp.market_family || ""), String(label || ""), {
        home: opp.team_home, away: opp.team_away,
      });
      if (!r.ok) return r as ResolveResult;
      return { ok: true, odds: r.selection.price, selection: r.selection };
    },
    async place(conn, s, stake) {
      return confirmTicket("BetMomo", await placeBetmomoBet(conn.token, {
        stake,
        eventId: s.eventId,
        price: s.price,
      }));
    },
  },

  // ── YELLOWBET (identifiant + mot de passe, exécuté DEPUIS le site via le pont) ──
  // Le site est verrouillé géographiquement : connexion et pose passent par le
  // pont yellowbetJina.ts. Les cotes fraîches se lisent dans le flux public.
  yellowbet: {
    matchIdField: "yellowbet_match_id",
    async connect(cred) {
      if (cred.login && cred.password) {
        const r = await loginYellowbetJina(cred.login, cred.password, secrets.get("JINA_API_KEY") || "");
        if (!r.success) {
          return {
            ok: false,
            reason: r.error === "bad_credentials"
              ? "Identifiants YellowBet refusés — reconnectez votre compte YellowBet dans Mise Auto"
              : r.error.startsWith("jina_") || r.error.startsWith("bridge_")
                ? "YellowBet momentanément injoignable — reprise automatique au prochain cycle"
                : `Connexion YellowBet refusée (${r.error})`,
          };
        }
        return {
          ok: true, token: r.session.token || "yellowbet", balance: r.session.account.balance, currency: r.session.account.currency,
          login: cred.login, password: cred.password,
        };
      }
      // Voie historique : jeton collé (solde illisible côté serveur, pose impossible).
      const raw = cred.token || cred.cookies || "";
      if (!raw) return { ok: false, reason: "Compte YellowBet non connecté — connectez YellowBet dans Mise Auto" };
      const r = await loginYellowbetToken(raw);
      if (!r.success) return { ok: false, reason: `Connexion YellowBet refusée (${r.error})` };
      return { ok: true, token: r.session.token, balance: r.session.account.balance, currency: r.session.account.currency };
    },
    async resolve(_opp, coupon, matchId) {
      const eventId = coupon?.eventId || matchId;
      if (!eventId || !coupon?.betTypeId || coupon?.oddKey == null) {
        return { ok: false, code: "no_selection_id", reason: "Identifiant de sélection YellowBet absent de l'opportunité" };
      }
      // La ligne et le libellé du coupon lèvent toute ambiguïté sur l'issue
      // (une même clé se répète sur chaque ligne d'un marché de totaux).
      const r = await readYellowbetOdds(eventId, coupon.betTypeId, String(coupon.oddKey), secrets.get("JINA_API_KEY") || "", {
        line: coupon.oddLine ?? coupon.line ?? null,
        name: coupon.oddName || coupon.oddDisplayName || "",
      });
      if (!r.ok) return r;
      return {
        ok: true,
        odds: r.price,
        selection: {
          ...coupon, eventId, price: r.price, isLive: !!coupon.isLive,
          // Noms frais lus chez YellowBet → soumis au contrôle de conformité.
          market: r.market || coupon.betTypeName || "",
          label: r.label || coupon.oddDisplayName || coupon.oddName || String(coupon.oddKey),
          line: r.line,
          betTypeName: r.market || coupon.betTypeName || "",
          oddName: r.label || coupon.oddName || String(coupon.oddKey),
          oddDisplayName: r.label || coupon.oddDisplayName || String(coupon.oddKey),
        },
      };
    },
    async place(conn, s, stake) {
      if (!conn.login || !conn.password) {
        return { success: false, error: "YellowBet : la pose automatique exige la connexion par identifiant + mot de passe" };
      }
      const res = await placeYellowbetJina(conn.login, conn.password, s, stake, secrets.get("JINA_API_KEY") || "");
      if (!res.success) return res;
      const done: any = confirmTicket("YellowBet", res);
      return done?.success ? { ...done, appliedOdds: res.appliedOdds } : done;
    },
  },
};

// ═══════════════════════════════════════════════════════════════════
// CONTRÔLE DE CONFORMITÉ — appliqué à TOUS les bookmakers d'un seul geste.
//
// Chaque `resolve` renvoie la sélection réellement trouvée chez le bookmaker.
// Avant que le moteur ne l'utilise, on vérifie qu'elle porte bien la même
// statistique, la même période, le même camp et la même ligne que la jambe
// affichée (voir legAudit.ts). Au moindre désaccord certain, la jambe est
// déclarée indisponible : aucune mise ne part.
//
// C'est ce filtre qui empêche les deux incidents constatés :
//   • le même camp joué deux fois (oddId 1win désignant l'équipe adverse),
//   • un pari « corners » posé sur le marché de buts.
// ═══════════════════════════════════════════════════════════════════
function withAudit(book: string, ad: BookAdapter): BookAdapter {
  return {
    ...ad,
    async resolve(opp, coupon, matchId, label, ctx) {
      const r = await ad.resolve(opp, coupon, matchId, label, ctx);
      if (!r.ok || !r.selection || typeof r.selection !== "object") return r;
      const verdict = auditSelection(book, opp || {}, String(label || ""), r.selection as Record<string, any>);
      if (!verdict.ok) return { ok: false, code: verdict.code, reason: verdict.reason };
      return r;
    },
  };
}

export const ADAPTERS: Record<string, BookAdapter> = Object.fromEntries(
  Object.entries(RAW_ADAPTERS).map(([book, ad]) => [book, withAudit(book, ad)]),
);

// « 1xbet_mobile » = alias vers l'adaptateur « 1xbet » hybride (mobile + web).
ADAPTERS["1xbet_mobile"] = ADAPTERS["1xbet"];

/** Books réellement automatisables — dérivé des adaptateurs, jamais à maintenir à la main. */
export const AUTO_BOOKS = Object.keys(ADAPTERS);