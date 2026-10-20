import { cashoutTicket } from "./onewinCashout.ts";
import { betpawaCashout } from "./betpawaCashout.ts";
import { BETPAWA_COUNTRIES } from "./betpawaCountries.ts";

// Arbitrage : une jambe est passée, l'autre a été refusée et aucune couverture
// n'a abouti. Plutôt que de laisser la mise à nu, on la RACHÈTE (cash-out) au
// montant proposé par le site — perte limitée à la marge du bookmaker (~2-5 %).
// Sites capables : 1win et betPawa (mêmes appels que le rattrapage des buts annulés).
export async function cashoutExposedLeg(book: string, conn: any, ticketId: string) {
  if (!ticketId || !conn?.token) return { ok: false, reason: "ticket ou session manquant" };
  let call: () => Promise<any>;
  if (book === "1win") call = () => cashoutTicket(conn.token, ticketId);
  else if (book === "betpawa") {
    const c = BETPAWA_COUNTRIES.find((x) => x.host === conn.host) || BETPAWA_COUNTRIES[0];
    call = () => betpawaCashout({ token: conn.token, host: c.host, brand: c.brand, iso: c.iso }, ticketId);
  } else return { ok: false, reason: `cash-out non disponible chez ${book}` };
  // Le site bloque souvent le rachat quelques secondes juste après la pose : 6 essais espacés de 4 s
  let r: any = null;
  for (let i = 0; i < 6; i++) {
    r = await call().catch((e) => ({ ok: false, reason: String(e?.message || e) }));
    if (r.ok) return r;
    await new Promise((s) => setTimeout(s, 4000));
  }
  return r;
}