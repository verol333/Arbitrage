// Lecture cotes PremierBet — nouveau backend markets INLINE dans __raw.markets.
// Pas de fetch détail nécessaire (économie budget Scrape.do massive vs ancien flow).
import { premierbetFlatOdds } from './parse.js';

export async function getOdds(match) {
  const markets = match.__raw?.markets || [];
  return premierbetFlatOdds(markets);
}
