import { decodeCred } from "./placeArbitrageBet.ts";
import { ADAPTERS } from "./autoBookAdapters.ts";
import { dbRetry } from "./dbRetry.ts";

// Exécution d'un pari automatique 1win ou betPawa (scanner probabilités / retard de but).
// Appelé directement sur nos serveurs, ou via goalLagIngest par le scanner GitHub.
// Chaque site a son propre capital de test de 500 F par stratégie.
export const STAKE = 100, CAPITAL = 500;
const NAME: Record<string, string> = { "1win": "1win", betpawa: "betPawa", congobet: "Congobet" };
const conns: Record<string, any> = {};

const log = (db: any, action: string, ok: boolean, message: string, book = "1win", details?: any) =>
  db.AppLog.create({ area: "mise_auto_proba", action, level: ok ? "info" : "error", ok, message: message.slice(0, 2000), book: NAME[book] || book, details }).catch(() => null);

export async function connectBook(db: any, book = "1win") {
  if (conns[book]?.ok) return conns[book];
  // Congobet : compte dédié enregistré dans les secrets de l'application
  if (book === "congobet") return conns[book] = await ADAPTERS.congobet.connect({ login: Deno.env.get("CONGOBET_LOGIN"), password: Deno.env.get("CONGOBET_PASSWORD") } as any);
  const admins = await dbRetry(() => db.User.filter({ role: "admin" }), 4);
  const u = admins.find((a: any) => (a.data?.auto_bookmakers || a.auto_bookmakers)?.credentials?.[book]);
  const blob = (u?.data?.auto_bookmakers || u?.auto_bookmakers)?.credentials?.[book];
  const cred = blob ? decodeCred(blob) : null;
  conns[book] = cred ? await ADAPTERS[book].connect(cred as any) : { ok: false, reason: `Compte ${NAME[book]} non connecté` };
  return conns[book];
}
export const connect1win = (db: any) => connectBook(db, "1win");

// Paris des 6 dernières heures (doublons + paris ouverts). En cas de refus de la base : dernière lecture connue.
const sent = new Set<string>();
let recentCache: { at: number; v: any[] } | null = null;
async function recentBets(db: any) {
  if (recentCache && Date.now() - recentCache.at < 20e3) return recentCache.v;
  const since = new Date(Date.now() - 6 * 3600e3).toISOString();
  const r = await dbRetry(() => db.ProbAutoBet.filter({ $or: [{ created_date: { $gte: since } }, { status: "placed" }] }, { limit: 500, fields: ["signal_key", "status", "source", "book"] }), 3).catch(() => null);
  if (r) recentCache = { at: Date.now(), v: r.items || [] };
  return recentCache?.v || [];
}

// Gain réglé par capital, relu au plus une fois par minute (la somme a une limite d'appels très basse)
const profitCache: Record<string, { at: number; v: number }> = {};
async function settledProfit(db: any, k: string, pool: any) {
  const c = profitCache[k];
  if (c && Date.now() - c.at < 60e3) return c.v;
  const agg = await db.ProbAutoBet.aggregate({ query: { status: { $in: ["won", "lost", "void"] }, ...pool }, sum: "profit" }).catch(() => null);
  const v = agg ? Number(agg.rows?.[0]?.sum_profit || 0) : c?.v ?? 0;
  profitCache[k] = { at: Date.now(), v };
  return v;
}

const bookOf = (b: any) => b.book === "betpawa" || b.book === "congobet" ? b.book : "1win";

/** base = fiche ProbAutoBet (base.book = 1win | betpawa) ; o = cote {id, cf, status} ou null ; dry = essai à blanc. */
// Interrupteurs de stratégie de l'administrateur (relus au plus toutes les 30 s)
let modes: { at: number; v: any } = { at: 0, v: {} };
async function modeOn(db: any, k: "goal" | "prob" | "tennis") {
  if (Date.now() - modes.at > 30000) {
    const a = await db.User.filter({ role: "admin" }).catch(() => null);
    if (a) modes = { at: Date.now(), v: a[0]?.strategy_modes || a[0]?.data?.strategy_modes || {} };
  }
  // Tennis arrêté définitivement : plus aucune mise tennis
  return k !== "tennis" && modes.v[k] !== false;
}
// final = false : tentative intermédiaire (relance prévue) — un échec n'est pas enregistré.
export async function execBet(db: any, { base, o, dry, final = true }: { base: any; o: any; dry?: boolean; final?: boolean }) {
  const keep = !dry && final;
  const book = bookOf(base), bn = NAME[book];
  const goal = base.source === "goal";
  // Tennis : capital de test et interrupteur à part (source "tennis")
  const src = base.source === "tennis" ? "tennis" : goal ? "goal" : "prob";
  const srcOf = (b: any) => b.source === "tennis" ? "tennis" : b.source === "goal" ? "goal" : "prob";
  const pool = { ...(src === "prob" ? { source: { $nin: ["goal", "tennis"] } } : { source: src }), ...(book === "1win" ? { book: { $nin: ["betpawa", "congobet"] } } : { book }) };
  const [recent, profit] = await Promise.all([recentBets(db), settledProfit(db, `${src}|${book}`, pool)]);
  const dup = recent.filter((b: any) => b.signal_key === base.signal_key).length + (sent.has(base.signal_key) ? 1 : 0);
  const open = recent.filter((b: any) => b.status === "placed" && srcOf(b) === src && bookOf(b) === book).length;
  const tag = `${src === "tennis" ? "[Tennis] " : ""}${base.match_label} ${base.minute ?? ""}' [${base.market_label}] @${base.odd}`;
  if (dup > 0) return { step: "doublon" };
  if (!(await modeOn(db, src))) { if (src === "tennis") await log(db, "desactive", false, `Tennis désactivé, pari non tenté : ${tag}`, book); return { step: "desactive" }; }
  // Règle fixe : tennis 100 F, foot 250 F par pari. Plus de plafond de capital : tout ce qui est détecté est misé.
  void open; void profit;
  const stake = src === "tennis" ? 100 : 250;
  if (!o?.id || o.status !== 1) {
    if (keep) await db.ProbAutoBet.create({ ...base, status: "failed", error: `Cote ${bn} introuvable ou fermée` });
    await log(db, "cote", false, `Cote ${bn} introuvable ou fermée : ${tag}`, book, { dry }); return { step: "cote" };
  }
  let c = await connectBook(db, book);
  if (!c.ok) {
    if (keep) await db.ProbAutoBet.create({ ...base, status: "failed", error: c.reason });
    await log(db, "connexion", false, `Connexion ${bn} refusée (${c.reason}) : ${tag}`, book, { dry }); return { step: "connexion", reason: c.reason };
  }
  if (dry) { await log(db, "essai_blanc", true, `Essai à blanc OK, solde ${c.balance ?? "?"} : ${tag}`, book, { oddId: o.id, cf: o.cf }); return { step: "pret", balance: c.balance ?? null }; }
  const t0 = Date.now();
  const sel = book === "congobet"
    ? { eventId: Number(o.ev), eventBetTypeId: Number(o.bt), eventBetTypeItemId: Number(o.id), odds: Number(o.cf) }
    : book === "betpawa"
    ? { selectionId: String(o.id), odds: Number(o.cf) }
    : { oddId: String(o.id), cf: Number(o.cf), matchId: Number(base.onewin_match_id) };
  const put = (cx: any) => ADAPTERS[book].place(cx, sel, stake).catch((e: any) => ({ success: false, error: e.message }));
  let r: any = await put(c);
  // Session gardée en mémoire expirée : on se reconnecte et on remise aussitôt.
  if (!r?.success && /unauthenticated|expir|unauthori/i.test(JSON.stringify(r ?? ""))) {
    conns[book] = null;
    c = await connectBook(db, book);
    if (c.ok) r = await put(c);
  }
  if (r?.success) sent.add(base.signal_key);
  const det = { oddId: o.id, cf_envoyee: o.cf, cote_confirmee: r?.appliedOdds ?? null, ticket: r?.betId ?? r?.ticketId ?? null, duree_ms: Date.now() - t0, final, reponse: JSON.stringify(r ?? null).slice(0, 1500) };
  if (!r?.success && /unauthenticated|expir|unauthori/i.test(JSON.stringify(r ?? ""))) conns[book] = null;
  if (r?.success || final) await dbRetry(() => db.ProbAutoBet.create(r?.success
    ? { ...base, status: "placed", ticket_id: (r.ticketId ?? r.ticket?.betslipId) ? String(r.ticketId ?? r.ticket.betslipId) : undefined, odd: Number(r.appliedOdds || o.cf), stake: Number(r.acceptedStake || stake) }
    : { ...base, status: "failed", error: String(r?.error || `Refus ${bn}`).slice(0, 1000) }));
  await log(db, "placement", !!r?.success, `${r?.success ? `Pari posé, cote confirmée par ${bn} ${Number(r.appliedOdds || o.cf)}` : `Refus ${bn}${final ? "" : " (relance prévue)"} (${r?.error})`} : ${tag}`, book, det);
  return { step: r?.success ? "pose" : "refus", error: r?.error || null };
}