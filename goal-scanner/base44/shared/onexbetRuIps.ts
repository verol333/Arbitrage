// ═══════════════════════════════════════════════════════════════════
// POOL D'IP RUSSES — contournement du geofencing 1xBet (erreur 157662).
//
// DÉCOUVERTE (vérifiée en production le 2026-08-20) : 1xBet ne se fie PAS
// uniquement à l'IP réseau, il fait confiance aux en-têtes d'IP transmis
// (X-Forwarded-For & co). Une IP russe dans ces en-têtes + x-fcountry=1
// suffit à faire disparaître le 157662 — AUCUN proxy n'est nécessaire.
//
// Ce ne sont donc PAS des proxies : juste des adresses IP russes réelles
// utilisées comme valeur d'en-tête. Rien à payer, rien à maintenir.
// Source d'origine : liste publique proxifly/free-proxy-list (pays RU).
//
// L'ordre compte : la première IP est celle validée en premier. En cas de
// blocage sur une IP, l'appelant passe automatiquement à la suivante.
// ═══════════════════════════════════════════════════════════════════

export const RU_IPS: string[] = [
  "95.31.16.116",   // validée : refresh Success:true
  "147.45.60.139",
  "141.98.85.49",
  "109.191.114.251",
  "194.67.51.210",
  "88.201.248.85",
  "130.193.43.183",
  "93.90.231.101",
  "85.198.82.207",
  "176.32.33.164",
  "85.143.254.38",
  "95.31.158.48",
  "195.19.52.187",
  "213.135.88.58",
  "145.255.239.78",
  "45.8.88.236",
  "217.76.39.4",
  "46.0.229.208",
];

/** Nombre d'IP différentes essayées avant d'abandonner sur un appel. */
export const MAX_IP_TRIES = 6;

/** Code d'erreur 1xBet « application non disponible dans votre pays ». */
export const GEO_BLOCK_CODE = 157662;

/** Dernière IP ayant fonctionné — réutilisée en priorité (moins d'essais). */
let _workingIp: string | null = null;

export function getWorkingIp(): string | null {
  return _workingIp;
}

export function setWorkingIp(ip: string): void {
  _workingIp = ip;
}

/** Ordre d'essai : l'IP qui marche d'abord, puis les autres. */
export function ipsToTry(): string[] {
  const rest = RU_IPS.filter((ip) => ip !== _workingIp);
  return (_workingIp ? [_workingIp, ...rest] : rest).slice(0, MAX_IP_TRIES);
}