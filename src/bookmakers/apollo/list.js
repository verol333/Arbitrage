import { APOLLO_SID, apolloGet } from './api.js';

// Apollo expose peu de champs live au niveau list ; on tente Result / MatchResults.
function apolloLiveMeta(m) {
  const r = m.Result || m.MatchResult || null;
  let home = null, away = null;
  if (r) {
    home = r.HomeScore ?? r.Home ?? r.H ?? null;
    away = r.AwayScore ?? r.Away ?? r.A ?? null;
  }
  if (home == null && Array.isArray(m.MatchResults) && m.MatchResults.length) {
    const last = m.MatchResults[m.MatchResults.length - 1];
    home = last?.HomeScore ?? last?.Home ?? null;
    away = last?.AwayScore ?? last?.Away ?? null;
  }
  const score = (home != null && away != null) ? `${home}-${away}` : null;
  // Apollo n'expose pas la minute côté catalog ; laissé null (statut lisible via LiveStatusString).
  const period = m.LiveStatusString || null;
  return { score, minute: null, period };
}

export async function listMatches({ live = false, maxMatches = 1500, sport = 'football' } = {}) {
  const sid = APOLLO_SID[sport];
  if (!sid) return [];
  const now = new Date().toISOString();
  const dateTo = '2046-04-07T22:59:59.000Z';
  const out = [];
  const seen = new Set();
  const isVirtual = (h, a, lg) => /\bsrl\b|simulated|\besoccer\b|e-?soccer|\bcyber\b|\bvirtual\b|\besports?\b|\bfifa\b/i.test(`${h} ${a} ${lg}`);
  const PAGE = 200;
  for (let offset = 0; offset < maxMatches; offset += PAGE) {
    let path = `/sport/offer/v3/sports/offer?Offset=${offset}&Limit=${PAGE}&DateFrom=${now}&DateTo=${dateTo}&SportIds=${sid}`;
    if (live) path += '&Live=true';
    const j = await apolloGet(path);
    if (!j?.Response) break;
    let added = 0;
    for (const s of j.Response) for (const c of s.Categories || []) for (const l of c.Leagues || []) for (const m of l.Matches || []) {
      if (!m.Id || !m.TeamHome || !m.TeamAway) continue;
      if (seen.has(m.Id)) continue;
      const leagueName = `${c.Name} / ${l.Name}`;
      if (isVirtual(m.TeamHome, m.TeamAway, leagueName)) continue;
      seen.add(m.Id);
      const liveMeta = live ? apolloLiveMeta(m) : null;
      out.push({
        id: m.Id, home: m.TeamHome, away: m.TeamAway,
        league: leagueName,
        start: m.MatchStartTime ? new Date(m.MatchStartTime).getTime() : null,
        __raw: { code: m.EventCode || null },
        live: liveMeta,
      });
      added++;
    }
    if (!added) break;
  }
  return out;
}

export async function fetchOffers(ids) {
  const map = new Map();
  const BATCH = 16;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const res = await Promise.all(batch.map((id) => apolloGet(`/sport/offer/v3/match/offers?MatchId=${id}`)));
    res.forEach((m, k) => {
      if (m && m.Id) map.set(batch[k], m.Offers && m.Offers.length ? m.Offers : (m.BasicOffer ? [m.BasicOffer] : []));
    });
  }
  return map;
}
