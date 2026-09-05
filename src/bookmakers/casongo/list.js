// Liste des matchs Casongo — GetUpcomingMatches?SportId=1 renvoie les matchs a
// venir AVEC leurs marches (TMs) : resultat, double chance, les deux equipes
// marquent, echelle des totaux. Un seul appel par cycle, donc aucune lecture
// par match (leur endpoint de detail n'est pas exploitable en lecture simple).
// Le flux est plafonne a 30 matchs par sport cote Casongo.
import { casongoGet } from './api.js';

export async function listMatches({ live = false, sport = 'football' } = {}) {
  if (sport !== 'football' || live) return [];
  const json = await casongoGet('/WebSite/GetUpcomingMatches?SportId=1&SportTypeId=1');
  const rows = json?.Ms;
  if (!Array.isArray(rows)) return [];
  const now = Date.now();
  const out = [];
  for (const m of rows) {
    const home = m.Cs?.find((c) => c.O === 1) || m.Cs?.[0];
    const away = m.Cs?.find((c) => c.O === 2) || m.Cs?.[1];
    if (!m.MI || !home?.TN || !away?.TN) continue;
    // TimeZone=0 demande a l'API : ST est deja en UTC.
    const start = Date.parse(`${m.ST}Z`);
    if (!Number.isFinite(start) || start < now - 3600_000) continue;
    out.push({
      id: String(m.MI),
      home: home.TN.trim(),
      away: away.TN.trim(),
      league: (m.CN || '').trim(),
      start,
      // Marches livres avec la liste : le parseur les lit sans appel reseau.
      __raw: { MI: m.MI, Cs: m.Cs, Ms: m.TMs || [] },
    });
  }
  console.log(`[casongo] ${out.length} match(s) foot avec marches`);
  return out;
}
