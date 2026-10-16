// ═══════════════════════════════════════════════════════════════════
// BETPAWA — retrouve l'ID d'un match à partir des NOMS D'ÉQUIPES.
//
// Le scanner externe n'envoie pas l'ID de match betPawa (seulement l'ID de
// sélection, qui n'est pas interrogeable seul : /prices?ids= renvoie 404).
// On retrouve donc le match dans les listes officielles :
//   GET /api/sportsbook/v4/events/lists/by-queries?q={queries:[{query:{...}}]}
//   → { responses:[ { responses:[ { id, name, category:{ id, name } } ] } ] }
// Contraintes constatées : `categories` obligatoire (ids valides uniquement),
// `take` plafonné à 100 → pagination par `skip`.
// ═══════════════════════════════════════════════════════════════════

import { sameTeam } from './teamMatch.ts';
import { BETPAWA_BY_HOST, DEFAULT_BETPAWA_COUNTRY } from './betpawaCountries.ts';

// ⚠️ ON CHERCHE LE MATCH SUR LE SITE OÙ LE PARI SERA POSÉ.
//
// betPawa a un catalogue PAR PAYS : le même match n'est pas forcément proposé
// au Cameroun et au Congo, et un prix peut être ouvert ici et retiré là-bas.
// On interrogeait toujours le site du Congo alors que la mise part du site du
// pays du compte : d'où des matchs « introuvables » et des sélections que
// betPawa refusait comme « hors ligne » tout en les affichant chez nous. Ce
// n'était pas le bookmaker qui se contredisait — c'étaient deux sites
// différents. Le site du compte est donc désormais la source de vérité.
const countryOf = (host?: string) => BETPAWA_BY_HOST[host || ""] || DEFAULT_BETPAWA_COUNTRY;

function headersFor(host?: string): Record<string, string> {
  const c = countryOf(host);
  const origin = `https://${c.host}`;
  return {
    accept: "application/json",
    devicetype: "web",
    origin,
    referer: `${origin}/`,
    "x-pawa-brand": c.brand,
    "x-pawa-language": c.lang,
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    cookie: `bp_country=${c.iso}`,
  };
}

// Ids de catégorie betPawa confirmés via /api/sportsbook/v4/categories/list/live :
// 2 = Football, 3 = Basketball, 452 = Tennis, 101 = eFootball.
// Le tennis manquait : TOUTES les opportunités tennis (très fréquentes en live)
// ressortaient « match introuvable » alors que le match était bien affiché.
const FALLBACK_CATEGORIES = ["2", "3", "452", "101"];

// Liste RÉELLE des sports proposés par betPawa, relue toutes les 10 min.
// Une liste figée dans le code rendait invisible tout sport ajouté par le
// bookmaker (hockey, volley, cricket…) : les matchs existaient, mais aucune
// opportunité ne pouvait être posée dessus. On lit donc la liste au lieu de la
// supposer, avec la liste figée en simple filet de sécurité.
const catCache = new Map<string, { at: number; ids: string[] }>();
const CAT_TTL_MS = 10 * 60 * 1000;

async function categories(host?: string): Promise<string[]> {
  const c = countryOf(host);
  const cached = catCache.get(c.host);
  if (cached && Date.now() - cached.at < CAT_TTL_MS) return cached.ids;
  // Liste COMPLÈTE des sports (et non la seule liste « live ») : un sport sans
  // match en cours disparaissait de la liste, et toutes ses affiches à venir
  // devenaient introuvables.
  const res = await fetch(`https://${c.host}/api/sportsbook/v4/categories/list`, {
    headers: headersFor(host),
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  const json = res?.ok ? await res.json().catch(() => null) : null;
  const ids = (json?.onlyMeta || [])
    .map((m: any) => String(m?.category?.id || ""))
    .filter(Boolean);
  if (!ids.length) return FALLBACK_CATEGORIES;
  catCache.set(c.host, { at: Date.now(), ids });
  return ids;
}

function norm(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|sc|ac|cf|afc|cd|club|women|femmes|u\d{2})\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Mots significatifs (≥ 4 lettres) d'un nom d'équipe. */
function keywords(team: string): string[] {
  return norm(team).split(" ").filter((w) => w.length >= 4);
}

/** Variantes d'équipe (U21, U19, féminines, réserves) à ne pas confondre avec l'équipe A. */
const VARIANTS = [/\bu\s?1[6-9]\b/, /\bu\s?2[0-3]\b/, /\bwomen\b/, /\bfemmes\b/, /\bladies\b/, /\breserves?\b/, /\bii\b/];
function isVariantMismatch(eventName: string, home: string, away: string): boolean {
  const ev = String(eventName || "").toLowerCase();
  const asked = `${home} ${away}`.toLowerCase();
  return VARIANTS.some((re) => re.test(ev) && !re.test(asked));
}

// Les noms diffèrent d'une langue à l'autre (« Barcelone » chez 1xBet,
// « Barcelona » chez betPawa) : l'appariement partagé gère ces variantes.
// ⚠️ CAUSE RÉELLE DES « MATCHS INTROUVABLES » (mesurée le 15/09/2026) :
// betPawa écrit les joueurs à l'envers, nom d'abord — « Mayo, Aidan » quand nos
// scanners annoncent « Aidan Mayo » — et abrège les clubs autrement
// (« HIK Hellerup » vs « Hellerup IK », « Rayo Vallecano » vs « VALLECANO »).
// L'appariement strict échouait donc sur la MAJORITÉ des opportunités live
// (tennis surtout), et le rapport disait « match introuvable » alors que le
// match était bien à l'affiche. On accepte désormais l'appariement par mot
// significatif (nom de famille / nom de ville), quel que soit l'ordre.
// Un nom court (« P. Bar », « Li », « Fu ») ne contient AUCUN mot de 4 lettres :
// il était donc systématiquement « introuvable » (16 échecs sur « Akira
// Santillan vs P. Bar » le 15/09/2026). Quand aucun mot long n'existe, on
// retient le mot le plus long du nom, dès 2 lettres.
function strongWords(name: string): string[] {
  const words = norm(name).split(" ").filter(Boolean);
  const long = words.filter((t) => t.length >= 4);
  if (long.length) return long;
  const best = words.reduce((a, b) => (b.length > a.length ? b : a), "");
  return best.length >= 2 ? [best] : [];
}

function looseMatch(side: string, asked: string): boolean {
  const A = norm(side).split(" ").filter((t) => t.length >= 2);
  const B = strongWords(asked);
  // Les mots courts (< 4 lettres) ne s'apparient qu'à l'identique : « bar » ne
  // doit pas reconnaître « barcelona ».
  return B.some((b) => A.some((a) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)))));
}

function looksLikeTeam(eventName: string, team: string): boolean {
  const [h, a] = String(eventName || "").split(" - ");
  if (sameTeam(h ?? eventName, team) || sameTeam(a ?? "", team)) return true;
  return looseMatch(h ?? eventName, team) || looseMatch(a ?? "", team);
}

// Une page REFUSÉE (429, coupure réseau) renvoyait une liste vide, exactement
// comme une fin de liste : le balayage s'arrêtait net et le match était déclaré
// « introuvable ». On réessaie une fois, et un échec est signalé (null) au lieu
// d'être confondu avec « plus de matchs ».
async function fetchPage(eventType: "LIVE" | "UPCOMING", skip: number, host?: string): Promise<Array<Record<string, any>> | null> {
  const q = { queries: [{ query: { eventType, categories: await categories(host), hasOdds: true }, take: 100, skip }] };
  const url = `https://${countryOf(host).host}/api/sportsbook/v4/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`;
  for (let i = 0; i < 2; i++) {
    const res = await fetch(url, { headers: headersFor(host), signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (res?.ok) {
      const json = await res.json().catch(() => null);
      const list = json?.responses?.[0]?.responses;
      if (Array.isArray(list)) return list as Array<Record<string, any>>;
      // Réponse acceptée mais sans liste = on a dépassé la fin du catalogue
      // (betPawa ne renvoie rien au-delà). Ce n'est PAS un refus : le signaler
      // comme tel remplissait le journal d'alertes et empêchait d'arrêter le
      // balayage à la bonne page.
      if (json) return [];
    }
    if (i === 0) await new Promise((r) => setTimeout(r, 600));
    else console.warn(`[betpawa-find] page ${eventType}+${skip} refusée (${res?.status ?? "réseau"})`);
  }
  return null;
}

// ── Mémoire des identifiants déjà trouvés ───────────────────────────
// L'identifiant d'un match ne change JAMAIS : une fois trouvé, inutile de
// rebalayer 1 200 matchs. C'était le point le plus lent du placement (~8 s) et
// il était refait pour chaque compte. Les cotes, elles, ne sont pas mises en
// cache ici : elles sont relues à chaque résolution.
const idCache = new Map<string, { at: number; id: string | null }>();
const ID_TTL_MS = 10 * 60 * 1000;

/**
 * Cherche l'ID du match betPawa correspondant aux deux équipes.
 * `isLive` détermine la liste interrogée en priorité ; l'autre sert de secours.
 */
export async function findBetpawaEventId(
  home: string,
  away: string,
  isLive = false,
  expectedTs?: number,
  host?: string,
): Promise<string | null> {
  // La mémoire est PAR SITE : le catalogue diffère d'un pays à l'autre, un match
  // absent au Congo peut être bien présent au Cameroun.
  const cacheKey = `${countryOf(host).host}|${norm(home)}|${norm(away)}|${isLive ? "live" : "pre"}|${expectedTs || 0}`;
  const hit = idCache.get(cacheKey);
  // Un échec est mémorisé brièvement aussi (1 min) : sinon 1 000 comptes
  // relancent 1 000 balayages complets pour un match absent de betPawa.
  if (hit && Date.now() - hit.at < (hit.id ? ID_TTL_MS : 60_000)) return hit.id;

  const found = await findBetpawaEventIdUncached(home, away, isLive, expectedTs, host);
  idCache.set(cacheKey, { at: Date.now(), id: found });
  if (idCache.size > 500) idCache.delete(idCache.keys().next().value as string);
  return found;
}

async function findBetpawaEventIdUncached(
  home: string,
  away: string,
  isLive = false,
  expectedTs?: number,
  host?: string,
): Promise<string | null> {
  // Deux matchs peuvent porter des noms proches (« Manchester United » joue aussi
  // en U21 le même week-end) : quand l'heure du coup d'envoi est connue, elle
  // sert d'arbitre définitif.
  const sameKickoff = (e: Record<string, any>) => {
    if (!expectedTs) return true;
    const st = Date.parse(e?.startTime || e?.startsAt || "");
    return Number.isFinite(st) && Math.abs(st - expectedTs) <= 90 * 60 * 1000;
  };

  const order: Array<"LIVE" | "UPCOMING"> = isLive ? ["LIVE", "UPCOMING"] : ["UPCOMING", "LIVE"];
  for (const type of order) {
    // betPawa propose ~1 200 matchs à venir : 4 pages (400) laissaient de côté
    // des affiches majeures (Bayern - Stuttgart était en page 11). On balaie
    // donc toute la liste, par lots parallèles pour rester rapide.
    const maxPages = type === "LIVE" ? 4 : 16;
    const BATCH = 4;
    for (let start = 0; start < maxPages; start += BATCH) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(BATCH, maxPages - start) }, (_, i) => fetchPage(type, (start + i) * 100, host)),
      );
      for (const events of batch) {
        const hit = (events || []).find((e) =>
          looksLikeTeam(e.name, home) && looksLikeTeam(e.name, away)
          && !isVariantMismatch(e.name, home, away) && sameKickoff(e));
        if (hit) return String(hit.id);
      }
      // Dernière page atteinte : la liste est épuisée, on arrête. Une page
      // refusée (null) n'arrête RIEN : on continue de balayer.
      const last = batch[batch.length - 1];
      if (last && last.length < 100) break;
    }
  }
  return null;
}