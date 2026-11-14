import { teamSim, norm } from '../src/core/text.js';
const pairs = [
  ['Suède', 'Sweden'], ['Belgique', 'Belgium'], ["Côte d'Ivoire", 'Ivory Coast'],
  ['FC Bayern Munich', 'FC Bayern München'], ['Sporting Lisbonne', 'Sporting CP'],
  ['Legia Varsovie', 'Legia Warszawa'], ['Standard Liège', 'Standard de Liège'],
  ['Inter Milan', 'Internazionale'], ['Copenhague', 'FC Kobenhavn'],
  ['Real Madrid', 'Real Sociedad'], ['Manchester United', 'Manchester City'],
  ['Congo', 'RD Congo'], ['Séoul E-Land', 'Seoul E-Land'],
];
for (const [a, b] of pairs) {
  console.log(String(teamSim(a, b).toFixed(2)).padStart(5), '|', a, 'vs', b, '->', norm(a), '/', norm(b));
}
