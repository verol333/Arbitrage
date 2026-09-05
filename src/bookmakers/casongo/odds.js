// Cotes Casongo — deja presentes dans la reponse de liste (match.__raw),
// donc aucune requete supplementaire par match.
import { casongoFlatOdds } from './parse.js';

export function getOdds(match, { sport = 'football', live = false } = {}) {
  if (sport !== 'football' || live) return null;
  const raw = match?.__raw;
  if (!raw?.Ms?.length) return null;
  return casongoFlatOdds(raw, { sport });
}
