// ═══════════════════════════════════════════════════════════════════
// BETPAWA — TABLE DES PAYS (vérifiée en direct sur les serveurs betPawa).
//
// betPawa a un site par pays, et un compte est rattaché au site de son pays :
// un numéro du Bénin se connecte sur www.betpawa.bj, pas sur celui du Congo.
// Chaque site exige son propre en-tête de marque (x-pawa-brand).
//
// ✅ Bonne nouvelle vérifiée : les IDENTIFIANTS DE MATCH ET DE SÉLECTION SONT
//    IDENTIQUES sur tous les sites (même match 37107235, même sélection
//    1515354749 au Congo, au Bénin, au Nigeria et au Cameroun). Le scanner
//    d'arbitrage et la résolution des cotes fonctionnent donc sans changement :
//    seule la CONNEXION doit viser le bon pays.
//
// `leadingZero` : le site attend-il le numéro local avec le 0 initial
// (Congo 067…, Nigeria 0803…) ou sans (Cameroun 6…, Mali 7…).
// ═══════════════════════════════════════════════════════════════════

export interface BetpawaCountry {
  /** Indicatif international, sans le + */
  prefix: string;
  name: string;
  /** Code ISO 2 lettres (cookie bp_country) */
  iso: string;
  host: string;
  brand: string;
  lang: string;
  leadingZero: boolean;
}

export const BETPAWA_COUNTRIES: BetpawaCountry[] = [
  { prefix: "242", name: "Congo-Brazzaville", iso: "CG", host: "cg.betpawa.com",     brand: "betpawa-congobrazzaville", lang: "fr", leadingZero: true },
  { prefix: "229", name: "Bénin",             iso: "BJ", host: "www.betpawa.bj",     brand: "betpawa-benin",            lang: "fr", leadingZero: true },
  { prefix: "237", name: "Cameroun",          iso: "CM", host: "www.betpawa.cm",     brand: "betpawa-cameroon",         lang: "fr", leadingZero: false },
  { prefix: "223", name: "Mali",              iso: "ML", host: "www.betpawa.ml",     brand: "betpawa-mali",             lang: "fr", leadingZero: false },
  { prefix: "243", name: "RD Congo",          iso: "CD", host: "www.betpawa.cd",     brand: "betpawa-drc",              lang: "fr", leadingZero: true },
  { prefix: "234", name: "Nigeria",           iso: "NG", host: "www.betpawa.ng",     brand: "betpawa-nigeria",          lang: "en", leadingZero: true },
  { prefix: "233", name: "Ghana",             iso: "GH", host: "www.betpawa.com.gh", brand: "betpawa-ghana",            lang: "en", leadingZero: true },
  { prefix: "254", name: "Kenya",             iso: "KE", host: "www.betpawa.co.ke",  brand: "betpawa-kenya",            lang: "en", leadingZero: true },
  { prefix: "256", name: "Ouganda",           iso: "UG", host: "www.betpawa.ug",     brand: "betpawa-uganda",           lang: "en", leadingZero: true },
  { prefix: "255", name: "Tanzanie",          iso: "TZ", host: "www.betpawa.co.tz",  brand: "betpawa-tanzania",         lang: "en", leadingZero: true },
  { prefix: "260", name: "Zambie",            iso: "ZM", host: "www.betpawa.co.zm",  brand: "betpawa-zambia",           lang: "en", leadingZero: true },
  { prefix: "265", name: "Malawi",            iso: "MW", host: "www.betpawa.mw",     brand: "betpawa-malawi",           lang: "en", leadingZero: true },
  { prefix: "258", name: "Mozambique",        iso: "MZ", host: "www.betpawa.co.mz",  brand: "betpawa-mozambique",       lang: "en", leadingZero: true },
  { prefix: "250", name: "Rwanda",            iso: "RW", host: "www.betpawa.rw",     brand: "betpawa-rwanda",           lang: "en", leadingZero: true },
];

/** Pays par défaut quand le numéro est saisi sans indicatif (site historique). */
export const DEFAULT_BETPAWA_COUNTRY = BETPAWA_COUNTRIES[0];

/** Retrouve le pays depuis son site (utilisé au placement du pari). */
export const BETPAWA_BY_HOST: Record<string, BetpawaCountry> = Object.fromEntries(
  BETPAWA_COUNTRIES.map((c) => [c.host, c]),
);

/** Retire espaces, tirets, parenthèses, + et les 00 internationaux. */
export function cleanNumber(raw: string): string {
  let v = String(raw || "").replace(/[\s\-().+]/g, "");
  if (v.startsWith("00")) v = v.slice(2);
  return v;
}

/** Retrouve le pays depuis son code ISO. */
export const BETPAWA_BY_ISO: Record<string, BetpawaCountry> = Object.fromEntries(
  BETPAWA_COUNTRIES.map((c) => [c.iso, c]),
);

/**
 * Pays reconnu UNIQUEMENT si le numéro porte son indicatif international.
 * null = numéro saisi au format local (cas le plus courant) : le pays ne peut
 * pas être devinté à partir des chiffres, il est alors identifié en interrogeant
 * les sites betPawa (voir loginBetpawa).
 */
export function betpawaCountryFromPrefix(raw: string): BetpawaCountry | null {
  const v = cleanNumber(raw);
  // Indicatif le plus long d'abord : évite qu'un 22x en morde un autre.
  const sorted = [...BETPAWA_COUNTRIES].sort((a, b) => b.prefix.length - a.prefix.length);
  return sorted.find((c) => v.startsWith(c.prefix) && v.length > c.prefix.length + 5) || null;
}

/**
 * Identifie le pays d'après l'indicatif du numéro.
 * Sans indicatif reconnu → Congo (valeur d'affichage par défaut seulement).
 */
export function detectBetpawaCountry(raw: string): BetpawaCountry {
  return betpawaCountryFromPrefix(raw) || DEFAULT_BETPAWA_COUNTRY;
}

/**
 * Formes possibles du numéro pour un pays : la forme attendue par le site, et
 * la variante 0/sans 0 — certains pays acceptent les deux, et l'utilisateur
 * saisit indifféremment l'une ou l'autre.
 */
export function numberForms(raw: string, country: BetpawaCountry): string[] {
  const primary = localNumber(raw, country);
  const alt = country.leadingZero ? primary.replace(/^0+/, "") : "0" + primary;
  return [...new Set([primary, alt])].filter((v) => v.length >= 7);
}

/** Met le numéro au format local attendu par le site du pays. */
export function localNumber(raw: string, country: BetpawaCountry): string {
  let v = cleanNumber(raw);
  if (v.startsWith(country.prefix) && v.length > country.prefix.length + 5) {
    v = v.slice(country.prefix.length);
  }
  if (country.leadingZero) {
    if (!v.startsWith("0")) v = "0" + v;
  } else {
    v = v.replace(/^0+/, "");
  }
  return v;
}