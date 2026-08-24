// BetPawa foot listing : appel /events/lists/by-queries (protobuf) → extraction
// des match IDs + startTime + league en 2 étapes :
//   1) Protobuf strings : match ID + team names + startTime ISO (si BetPawa les
//      met en clair dans le payload). Association par proximité byte offset.
//   2) Fallback /events/{id} pour TOUT match qui reste sans startTime après
//      étape 1 — évite les fake arbs sur matchs "orphelins" (dates différentes
//      inconnues qui matchaient blind sur similarité nom uniquement).
// Fix bug user (18/08) : FCI Levadia vs JK Narva Trans matché entre PremierBet
// (19/08 17:00) et BetPawa (autre date) → fake arb car BetPawa listing sans start.
import { bpFetchList, bpFetchEvent, buildEventsListUrl, isVirtual, splitTeams, CATEGORY_IDS, MARKET_TYPES_BY_SPORT, ISO_TS_RE } from './api.js';

const MARKET_TYPE_IDS = new Set(['3743', '28000810', '28000850', '3744', '3745', '3746', '3774', '2043818']);

// Fenêtre byte pour associer un match ID à ses métadonnées (name, startTime,
// competition) dans le protobuf. 2 KB couvre largement un event protobuf
// typique (markets inclus). Au-delà = probablement un autre event.
// 19/08 : fenetre reduite de 2048 a 256 octets. A 2 KB, l'ISO "le plus proche"
// pouvait appartenir a UN AUTRE event du meme payload -> BetPawa annoncait une
// heure de coup d'envoi qui n'etait pas la sienne, et un match d'une autre
// journee passait le contole de date. Au-dela de 256 octets on prefere ne PAS
// deviner : start reste null, puis l'heure est lue sur /events/{id} (source
// officielle) par le fallback d'enrichissement ci-dessous.
const ASSOC_WINDOW_BYTES = 256;

// Trouve la valeur la plus proche (en byte offset) qui satisfait un prédicat.
function findNearest(strings, offsets, anchorOffset, predicate) {
  let best = null;
  let bestDist = Infinity;
  for (let j = 0; j < strings.length; j++) {
    const d = Math.abs(offsets[j] - anchorOffset);
    if (d > ASSOC_WINDOW_BYTES) continue;
    if (d >= bestDist) continue;
    if (!predicate(strings[j], j)) continue;
    bestDist = d;
    best = strings[j];
  }
  return best;
}

export async function listMatches({ live = false, sport = 'football' } = {}) {
  const category = CATEGORY_IDS[sport];
  if (!category) return [];
  const marketTypes = MARKET_TYPES_BY_SPORT[sport] || MARKET_TYPES_BY_SPORT.football;
  const eventType = live ? 'LIVE' : 'UPCOMING';
  const seen = new Set();
  const out = [];
  const PAGE = 100;
  const HARD_CAP = 2000;

  for (let skip = 0; skip < HARD_CAP; skip += PAGE) {
    const url = buildEventsListUrl({ eventType, categories: [category], marketTypes, skip, take: PAGE });
    const { strings, offsets } = await bpFetchList(url);
    if (!strings.length) break;

    let added = 0;
    for (let i = 0; i < strings.length; i++) {
      const s = strings[i];
      if (!/^\d{7,10}$/.test(s)) continue;
      if (MARKET_TYPE_IDS.has(s)) continue;
      const name = strings[i + 1] || '';
      if (!name.includes(' - ') || /1X2|UP|LIVE|UPCOMING|FT$/.test(name)) continue;
      const teams = splitTeams(name);
      if (!teams) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      if (isVirtual(`${teams.home} ${teams.away}`)) continue;

      // Extraction startTime depuis protobuf : cherche la string ISO la plus
      // proche (byte offset) du match ID. Si BetPawa embed les timestamps en
      // clair (couramment le cas pour les payload gRPC/protobuf non-optimisés),
      // on le récupère sans requête additionnelle.
      const anchor = offsets[i];
      const isoStr = findNearest(strings, offsets, anchor, (str) => ISO_TS_RE.test(str));
      let start = null;
      if (isoStr) {
        const t = Date.parse(isoStr);
        if (Number.isFinite(t)) start = t;
      }

      out.push({
        id: s,
        home: teams.home,
        away: teams.away,
        league: '',
        start,
      });
      added++;
    }
    if (added === 0) break;
  }

  // FALLBACK ENRICHISSEMENT : tout match qui reste sans startTime après extraction
  // protobuf est enrichi via /events/{id} pour récupérer startTime + competitionName.
  // Cible :
  //  - Matchs "orphelins" (protobuf n'expose pas leur ISO timestamp)
  //  - Matchs "doublons" (mêmes team names, plusieurs matchs — league nécessaire
  //    pour disambigüer, ex: SWPL Cup vs friendly)
  // Coût : parallèle par batch de 20 pour rester poli avec BetPawa.
  // Le cache 30s de bpFetchEvent est partagé avec getOdds → pas de doublon.
  const orphans = out.filter(m => !m.start);
  // Doublons : matchs avec même paire (home,away) — need league to distinguish
  const normKey = (h, a) => `${String(h || '').toLowerCase().replace(/\s+/g, '')}|${String(a || '').toLowerCase().replace(/\s+/g, '')}`;
  const groups = new Map();
  for (const m of out) {
    const k = normKey(m.home, m.away);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  const duplicates = [];
  for (const [, matches] of groups) {
    if (matches.length >= 2) duplicates.push(...matches.filter(m => !m.league));
  }
  // Union orphans + duplicates (par id, pas de double-enrichissement)
  const toEnrichIds = new Set();
  for (const m of orphans) toEnrichIds.add(m.id);
  for (const m of duplicates) toEnrichIds.add(m.id);
  const toEnrich = out.filter(m => toEnrichIds.has(m.id));

  if (toEnrich.length) {
    console.log(`[betpawa:${sport}] fallback enrichment ${toEnrich.length} matchs (${orphans.length} sans start, ${duplicates.length} doublons)`);
    const BATCH = 20;
    for (let i = 0; i < toEnrich.length; i += BATCH) {
      const chunk = toEnrich.slice(i, i + BATCH);
      await Promise.all(chunk.map(async (m) => {
        const ev = await bpFetchEvent(m.id, 8_000, { fresh: false });
        if (!ev) return;
        // Structure BetPawa event : { startTime: "2026-08-05T19:30:00Z", competitionName, categoryName, ...}
        if (ev.startTime && !m.start) {
          const t = Date.parse(ev.startTime);
          if (Number.isFinite(t)) m.start = t;
        }
        if (!m.league) {
          m.league = ev.competitionName || ev.category?.name || ev.competition?.name || '';
        }
      }));
    }
    const startEnriched = toEnrich.filter(m => m.start).length;
    const leagueEnriched = toEnrich.filter(m => m.league).length;
    console.log(`[betpawa:${sport}] fallback done : ${startEnriched}/${toEnrich.length} avec start, ${leagueEnriched}/${toEnrich.length} avec league`);
  }
  const withStart = out.filter(m => m.start).length;
  console.log(`[betpawa:${sport}] ${eventType} : ${out.length} matchs listés (${withStart} avec startTime, ${out.length - withStart} sans)`);
  return out;
}
