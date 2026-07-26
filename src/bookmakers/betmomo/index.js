import { listMatches } from './list.js';
import { betmomoFlatOdds } from './parse.js';

// BetMomo utilise BetConstruct SWARM WS — même comportement que YellowBet en LIVE :
// lignes des marchés Under/Over/DC/BTTS/Handicap ajustées dynamiquement au score
// en cours + potentiel léger delay entre snapshot et cote affichée sur le site.
// User a signalé opps fantômes : cotes lues incorrectes vs cotes réelles bookmaker.
// STRATÉGIE STRICTE en LIVE : ne garder que 1X2 (match_1/X/2) et DNB (dnb_1/2)
// qui ne dépendent pas du contexte live.
function sanitizeLiveBetMomo(odds) {
  const out = {};
  for (const [k, v] of Object.entries(odds || {})) {
    if (/^match_[12X]$/.test(k)) out[k] = v;
    else if (/^dnb_[12]$/.test(k)) out[k] = v;
  }
  return out;
}

export default {
  key: 'betmomo',
  label: 'BetMomo',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    return listMatches({ live, horizonHours, sport });
  },
  async getOdds(match, { live = false } = {}) {
    const raw = betmomoFlatOdds(match.__raw?.markets || []);
    return live ? sanitizeLiveBetMomo(raw) : raw;
  },
};
