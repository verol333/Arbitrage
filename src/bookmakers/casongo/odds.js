// Fetch cotes match Casongo — GetMatchById?MatchId=<id> retourne le match
// complet avec tous ses marchés (Ms[]) déjà remplis (pas d'appel séparé).
import { casongoGet } from './api.js';
import { casongoFlatOdds } from './parse.js';

export async function getOdds(matchId, { live = false, noCache = false, sport = 'football' } = {}) {
  if (sport !== 'football' || live) return null;
  const json = await casongoGet(`/WebSite/GetMatchById?MatchId=${encodeURIComponent(matchId)}`, { noCache });
  if (!json?.MI) return null;
  return casongoFlatOdds(json, { sport });
}
