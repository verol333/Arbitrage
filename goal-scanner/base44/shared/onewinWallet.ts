// ═══════════════════════════════════════════════════════════════════
// CHOIX DU PORTEFEUILLE 1WIN.
//
// Un compte 1win possède PLUSIEURS portefeuilles : sa devise réelle (XAF, XOF,
// CDF…) plus une longue liste de portefeuilles crypto ouverts d'office.
//
// L'ancienne règle écartait les cryptos par une liste noire (BTC, ETH, USDT…).
// Problème : la liste ne pouvait pas être exhaustive — un compte crédité en
// XAF s'est retrouvé affiché « en XLM » simplement parce que XLM n'y figurait
// pas et contenait un résidu plus élevé que le portefeuille principal vide.
//
// Nouvelle règle, sans liste noire : on ne retient que les devises COURANTES
// (monnaies réelles, liste blanche). Parmi elles :
//   1) le portefeuille principal du compte (devise déclarée) s'il a de l'argent ;
//   2) sinon le portefeuille réel le mieux approvisionné ;
//   3) sinon le portefeuille principal, même vide ;
//   4) sinon le premier portefeuille réel.
// Un compte réellement en crypto uniquement garde son portefeuille crypto.
// ═══════════════════════════════════════════════════════════════════

/** Devises réelles (monnaies d'État) acceptées comme portefeuille principal. */
const FIAT = new Set([
  // Afrique
  "XAF", "FCFA", "XOF", "CDF", "NGN", "GHS", "GNF", "KES", "TZS", "UGX",
  "RWF", "BIF", "ZAR", "MAD", "DZD", "TND", "EGP", "ETB", "ZMW", "MWK",
  "MZN", "AOA", "SLL", "LRD", "GMD", "CVE", "MGA", "MUR", "BWP", "NAD",
  "SDG", "SOS", "DJF", "KMF", "SCR", "SZL", "LSL", "STN", "ERN", "SSP",
  // International
  "USD", "EUR", "GBP", "CHF", "CAD", "AUD", "BRL", "INR", "TRY", "RUB",
  "UAH", "KZT", "UZS", "AZN", "GEL", "AMD", "BYN", "PLN", "CZK", "RON",
  "HUF", "BGN", "SEK", "NOK", "DKK", "JPY", "CNY", "KRW", "IDR", "MYR",
  "THB", "VND", "PHP", "PKR", "BDT", "LKR", "NPR", "AED", "SAR", "QAR",
  "KWD", "BHD", "OMR", "JOD", "ILS", "IRR", "IQD", "LBP", "MXN", "ARS",
  "CLP", "COP", "PEN", "UYU", "BOB", "PYG", "VES", "CRC", "DOP", "GTQ",
  "HNL", "NIO", "PAB", "JMD", "TTD", "NZD", "HKD", "SGD", "TWD", "MMK",
  "KHR", "LAK", "MNT", "MOP", "BND", "FJD", "PGK",
]);

export interface OnewinWallet { currency: string; balance: number }

const isFiat = (c: unknown) => FIAT.has(String(c || "").trim().toUpperCase());
const amount = (w: OnewinWallet) => Number(w?.balance) || 0;

/**
 * Choisit le portefeuille à afficher et à utiliser pour miser.
 * `accountCurrency` = devise déclarée du compte à la connexion (si connue).
 */
export function pickOnewinWallet(
  list: OnewinWallet[],
  accountCurrency?: string,
): OnewinWallet | null {
  if (!Array.isArray(list) || !list.length) return null;

  const fiat = list.filter((w) => isFiat(w?.currency));
  const declared = accountCurrency
    ? fiat.find((w) => String(w.currency).toUpperCase() === String(accountCurrency).toUpperCase())
    : null;
  // ⚠️ À défaut de devise déclarée, l'ancienne règle désignait d'office XAF
  // comme portefeuille principal. Un compte tenu en XOF (ou CDF) qui gardait
  // un résidu de quelques francs en XAF voyait donc ce résidu annoncé comme
  // son solde — d'où des « compte sans argent » alors que le compte était
  // approvisionné. On ne devine plus la devise : sans devise déclarée, c'est le
  // portefeuille réel le mieux approvisionné qui fait foi.
  const main = declared;
  const richestFiat = [...fiat].sort((a, b) => amount(b) - amount(a))[0] || null;
  const richestAny = [...list].sort((a, b) => amount(b) - amount(a))[0] || null;

  if (main && amount(main) > 0) return main;
  if (richestFiat && amount(richestFiat) > 0) return richestFiat;
  if (main) return main;
  if (fiat.length) return fiat[0];
  return richestAny;
}