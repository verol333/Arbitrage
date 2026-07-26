import { listPrematch, listLive } from './list.js';
import { yellowbetFlatOdds } from './parse.js';

// En LIVE, YellowBet (BetConstruct SWARM) ajuste dynamiquement les lignes des
// marchés au score en cours. User a signalé opps fantômes : cotes lues ne
// correspondent pas aux cotes réelles sur le site → mismatch mapping/timing.
// STRATÉGIE STRICTE : en LIVE, on ne garde que les marchés STABLES qui ne
// dépendent pas du contexte live (score/minute). En pratique :
//   ✅ 1X2 (match_1/X/2) : issue finale du match — stable
//   ✅ DNB (dnb_1/2) : issue si pas de match nul — stable
//   ❌ Under/Over totaux : ligne ajustée dynamiquement
//   ❌ Team totals : ligne ajustée dynamiquement
//   ❌ BTTS : cote fluctue fortement avec buts déjà marqués
//   ❌ Double Chance : dérivé de 1X2 mais fluctue en live
//   ❌ Handicap : peut être ajusté en live
// C'est restrictif mais fiable — mieux vaut moins d'opps que des fausses.
function sanitizeLiveYb(odds) {
  const out = {};
  for (const [k, v] of Object.entries(odds || {})) {
    if (/^match_[12X]$/.test(k)) out[k] = v;
    else if (/^dnb_[12]$/.test(k)) out[k] = v;
  }
  return out;
}

export default {
  key: 'yellowbet',
  label: 'YellowBet',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    // Sports YellowBet supportés : football (31), basketball (32),
    // tennis (35), volleyball (323). Hockey : non identifié.
    if (!['football', 'basketball', 'tennis', 'volleyball'].includes(sport)) return [];
    return live ? listLive(sport) : listPrematch(horizonHours, sport);
  },
  async getOdds(match, { live = false } = {}) {
    const raw = yellowbetFlatOdds(match.__raw?.bts || []);
    return live ? sanitizeLiveYb(raw) : raw;
  },
};
