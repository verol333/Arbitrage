// Parseur Maxibet — identique a BetMomo car meme stack BetConstruct SWARM
// (memes types de markets et events). Re-export du parser BetMomo pour eviter
// la duplication. Si Maxibet expose plus tard des types customises, forker ici.
export { betmomoFlatOdds as maxibetFlatOdds } from '../betmomo/parse.js';
