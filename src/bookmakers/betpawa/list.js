// BetPawa listing — lecture JSON directe de /events/lists/by-queries.
//
// Historique : ce fichier lisait la réponse en PROTOBUF et devinait chaque champ
// par proximité d'octets (match ID, nom, ISO de coup d'envoi), puis rattrapait
// les « orphelins » avec un appel /events/{id} par match. Deux défauts mesurés
// le 14/09 sur l'API réelle :
//   1) le filtre `view.marketTypes` faisait DISPARAÎTRE des matchs entiers
//      (basket live : 0 remonté alors que betPawa en publiait) — un sport dont
//      le marché demandé n'est pas ouvert à cet instant devenait invisible ;
//   2) le devinage protobuf renvoyait du bruit (tennis : 26 « noms » pour 13
//      vrais matchs) et coûtait un appel réseau par match sans heure de début.
//
// Le même endpoint répond en JSON complet avec `Accept: application/json` :
// id, nom, startTime, compétition, minute, période et score live. Plus de
// devinage, plus de rattrapage, et TOUS les matchs live du sport sont servis
// (mesuré : 100 % avec heure de coup d'envoi et championnat, 0 requête de
// rattrapage contre ~1 par match auparavant).
import { BASE, HDR_EVENT, CATEGORY_IDS, isVirtual, splitTeams } from './api.js';

const PAGE = 100;
const HARD_CAP = 2000;

function buildJsonListUrl({ eventType, category, skip, take }) {
  const q = { queries: [{ query: { eventType, categories: [String(category)], zones: {}, hasOdds: true }, skip, take }] };
  return `${BASE}/api/sportsbook/v4/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`;
}

async function fetchPage(url, timeoutMs = 20_000) {
  try {
    const res = await fetch(url, { headers: HDR_EVENT, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) { console.log(`[betpawa/list] status=${res.status}`); return []; }
    const data = await res.json();
    const evs = data?.responses?.[0]?.responses;
    return Array.isArray(evs) ? evs : [];
  } catch (e) {
    console.log(`[betpawa/list] err=${e.message}`);
    return [];
  }
}

// Score live : betPawa publie un résultat par participant et par période.
// On prend la période « match/total/courante », sinon la première disponible.
function liveScore(ev) {
  const rows = ev?.results?.participantPeriodResults;
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const vals = [];
  for (const side of ['HOME', 'AWAY']) {
    const row = rows.find((r) => String(r?.participant?.side || r?.participant?.type || '').toUpperCase().includes(side));
    const periods = row?.periodResults || [];
    const per = periods.find((p) => /match|total|current/i.test(String(p?.period?.slug || p?.period?.name || ''))) || periods[0];
    const v = per?.result ?? per?.value;
    if (v == null) return null;
    vals.push(String(v));
  }
  return vals.length === 2 ? vals.join('-') : null;
}

function liveMeta(ev) {
  const minuteRaw = ev?.results?.display?.minute;
  const minute = minuteRaw == null || minuteRaw === '' ? null : Number(minuteRaw);
  return {
    score: liveScore(ev),
    minute: Number.isFinite(minute) ? minute : null,
    period: ev?.results?.display?.currentPeriod?.name || ev?.results?.display?.currentPeriod?.slug || null,
  };
}

export async function listMatches({ live = false, sport = 'football' } = {}) {
  const category = CATEGORY_IDS[sport];
  if (!category) return [];
  const eventType = live ? 'LIVE' : 'UPCOMING';
  const seen = new Set();
  const out = [];

  for (let skip = 0; skip < HARD_CAP; skip += PAGE) {
    const evs = await fetchPage(buildJsonListUrl({ eventType, category, skip, take: PAGE }));
    if (!evs.length) break;
    for (const ev of evs) {
      const id = ev?.id == null ? '' : String(ev.id);
      if (!id || seen.has(id)) continue;
      const teams = splitTeams(String(ev?.name || ''));
      if (!teams) continue;
      seen.add(id);
      const league = ev?.competition?.name || ev?.competitionName || ev?.category?.name || '';
      if (isVirtual(`${teams.home} ${teams.away} ${league}`)) continue;
      const startMs = ev?.startTime ? Date.parse(ev.startTime) : NaN;
      const match = {
        id,
        home: teams.home,
        away: teams.away,
        league,
        start: Number.isFinite(startMs) ? startMs : null,
      };
      if (live) match.live = liveMeta(ev);
      out.push(match);
    }
    if (evs.length < PAGE) break;
  }

  const withStart = out.filter((m) => m.start).length;
  console.log(`[betpawa:${sport}] ${eventType} : ${out.length} matchs listés (${withStart} avec startTime, ${out.length - withStart} sans)`);
  return out;
}
