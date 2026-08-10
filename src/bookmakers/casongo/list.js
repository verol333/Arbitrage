// Liste matchs Casongo — un seul appel GetPrematchTree?SportId=1 retourne
// l'arbre complet (~400KB) : Sport → Régions (pays) → Catégories
// (championnats) → Matchs (id + kickoff + compétiteurs). ~900 matchs foot.
import { casongoGet } from './api.js';

export async function listMatches({ live = false, sport = 'football' } = {}) {
  if (sport !== 'football') return [];
  if (live) return [];  // prématch uniquement pour le MVP
  const json = await casongoGet('/WebSite/GetPrematchTree?SportId=1');
  if (!json?.Ss) return [];
  const footballSport = json.Ss.find((s) => s.SI === 1);
  if (!footballSport?.Rs) return [];
  const now = Date.now();
  const out = [];
  for (const region of footballSport.Rs) {
    for (const category of region.Cs || []) {
      for (const m of category.Ms || []) {
        // Compétiteurs : Cs[].O=1 = home, O=2 = away
        const home = m.Cs?.find((c) => c.O === 1);
        const away = m.Cs?.find((c) => c.O === 2);
        if (!home?.TN || !away?.TN) continue;
        // ST est ISO "2026-08-19T18:30:00" — la casongo API renvoie l'heure locale
        // configurée par PartnerName=casongo&TimeZone=1 (UTC+1). On force en UTC
        // pour rester cohérent avec les autres books (tous en UTC dans le pipeline).
        const start = new Date(m.ST + 'Z').getTime() - 3600_000;  // -1h pour compenser TimeZone=1
        if (!Number.isFinite(start) || start < now - 3600_000) continue;
        out.push({
          id: String(m.MI),
          home: home.TN.trim(),
          away: away.TN.trim(),
          league: (category.CN || '').trim(),
          start,
          __raw: { matchId: m.MI, categoryId: category.CI, regionId: region.RI },
        });
      }
    }
  }
  console.log(`[casongo] listMatches football → ${out.length} matches`);
  return out;
}
