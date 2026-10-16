// Cash-out betPawa (testé le 14/10 : 97,56 F rendus sur 100 F) : demande d'offre, acceptation, puis contrôle de l'état.
// Le montant est celui PROPOSÉ par betPawa ; l'offre change à chaque demande et expire vite.
export async function betpawaCashout(c: { token: string; host?: string; brand?: string; iso?: string }, betslipId: string) {
  const host = c.host || "cg.betpawa.com";
  const H = { accept: "*/*", "content-type": "application/json", devicetype: "web", origin: `https://${host}`, referer: `https://${host}/`,
    "x-pawa-brand": c.brand || "betpawa-congobrazzaville", "x-pawa-language": "fr", cookie: `bp_country=${c.iso || "CG"}; x-pawa-token=${c.token}`, "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36" };
  const api = async (path: string, b?: any) => {
    const r = await fetch(`https://${host}/api/cashout/v2/${path}`, { method: b ? "POST" : "GET", headers: H, body: b ? JSON.stringify(b) : undefined, signal: AbortSignal.timeout(15000) });
    return { status: r.status, j: await r.json().catch(() => null) };
  };
  const o = await api("request-offer", { betslipId });
  if (!o.j?.offerId) return { ok: false, reason: `offre refusée (${o.status} ${JSON.stringify(o.j).slice(0, 200)})` };
  let s = await api("confirm", { offerId: o.j.offerId });
  // betPawa répond « confirmed: false » puis valide en quelques secondes : on relit l'état
  for (let i = 0; i < 8 && s.j && !s.j.confirmed && s.j.statusId; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    s = await api(`status/${s.j.statusId}`);
  }
  const amount = Number(s.j?.payout?.net ?? o.j.payout?.net);
  return s.j?.confirmed ? { ok: true, amount } : { ok: false, reason: `non confirmé (${JSON.stringify(s.j).slice(0, 200)})` };
}