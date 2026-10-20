import { connect1win, connectBook } from "./probAutoExec.ts";
import { betpawaCashout } from "./betpawaCashout.ts";
import { BETPAWA_COUNTRIES } from "./betpawaCountries.ts";
import { ONEWIN_PLATFORM, ONEWIN_API } from "./onewinLiveWs.ts";

// Cash-out 1win : le montant est celui PROPOSÉ par 1win (refundInfo de la fiche du pari), jamais choisi par nous.
const call = async (token: string, path: string, body: any) => {
  const r = await fetch(`${ONEWIN_API}${path}`, {
    method: "POST", signal: AbortSignal.timeout(15000), body: JSON.stringify(body),
    headers: { accept: "application/json", "content-type": "application/json", origin: "https://1win.com", referer: "https://1win.com/", token, "x-external-partner-id": ONEWIN_PLATFORM, "x-lang": "fr-CI", "x-user-location": "CG" },
  });
  return await r.json().catch(() => null);
};

/** Rachète un ticket 1win au montant proposé. Renvoie { ok, amount } ou { ok: false, reason }. */
export async function cashoutTicket(token: string, betId: string) {
  const h = await call(token, "/bets/history/get", { betId });
  const info = h?.result?.bet?.refundInfo;
  if (!info?.allowed || !(Number(info.refundAmount) > 0)) return { ok: false, reason: "cash-out non proposé par 1win" };
  const r = await call(token, "/bets/refund", { betId, refundAmount: Number(info.refundAmount) });
  const amount = Number(r?.result?.success?.refundAmount);
  return Number.isFinite(amount) ? { ok: true, amount } : { ok: false, reason: JSON.stringify(r).slice(0, 300) };
}

/** But annulé : cash-out de tous les paris 1win « retard de but » posés sur ce but. */
export async function cashoutCancelledGoal(db: any, { xbet_id, score }: { xbet_id: number; score: string }) {
  const bets = (await db.ProbAutoBet.filter({ xbet_id, score, source: "goal", status: "placed", book: { $in: ["1win", "betpawa"] } }, { limit: 20 }).catch(() => ({ items: [] }))).items || [];
  if (!bets.length) return [];
  const conns: Record<string, any> = {};
  for (const bk of new Set(bets.map((b: any) => b.book))) conns[bk] = bk === "1win" ? await connect1win(db) : await connectBook(db, "betpawa");
  const out: any[] = [];
  for (const b of bets) {
    const c = conns[b.book];
    if (!c.ok || !b.ticket_id) { out.push({ id: b.id, ok: false, reason: c.ok ? "ticket inconnu" : c.reason }); continue; }
    // Le site peut suspendre le cash-out quelques secondes juste après l'annulation : 5 essais espacés de 3 s
    let r: any = null;
    for (let i = 0; i < 5; i++) {
      const bp = BETPAWA_COUNTRIES.find((x) => x.host === c.host) || BETPAWA_COUNTRIES[0];
      r = await (b.book === "betpawa" ? betpawaCashout({ token: c.token, host: bp.host, brand: bp.brand, iso: bp.iso }, b.ticket_id) : cashoutTicket(c.token, b.ticket_id)).catch((e) => ({ ok: false, reason: String(e) }));
      if (r.ok) break;
      await new Promise((s) => setTimeout(s, 3000));
    }
    // Enregistrement du rachat : réessayé, sinon le pari resterait « ouvert » et serait compté perdu au règlement
    if (r.ok) for (let k = 0; k < 5; k++) {
      const u = await db.ProbAutoBet.update(b.id, { status: "cashout", cashout_amount: r.amount, profit: Math.round((r.amount - b.stake) * 100) / 100, settled_at: new Date().toISOString() }).then(() => true).catch(() => false);
      if (u) break;
      await new Promise((s) => setTimeout(s, 2000));
    }
    await db.AppLog.create({ area: "mise_auto_proba", action: "cashout", level: r.ok ? "info" : "error", ok: r.ok, book: b.book,
      message: `${r.ok ? `Cash-out ${r.amount} F (mise ${b.stake} F)` : `Cash-out impossible (${r.reason})`} : but annulé ${b.match_label} ${b.score} [${b.market_label}]` }).catch(() => null);
    out.push({ id: b.id, ...r });
  }
  return out;
}