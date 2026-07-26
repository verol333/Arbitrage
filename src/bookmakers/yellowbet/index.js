import { listPrematch, listLive } from './list.js';
import { yellowbetFlatOdds } from './parse.js';

// En LIVE, YellowBet ajuste dynamiquement la ligne des marchés Under/Over au
// score en cours (ex: match à 3-0 en 63e min → l=3.5 = "au moins 4 buts au
// total" avec cote adjustée). Les autres books utilisent des lignes fixes
// pré-live → comparaison faussée = arbs fantômes.
// Fix : en LIVE, on retire les marchés Under/Over totaux (match_over/under_*)
// et Under/Over mi-temps qui subissent le même adjustement dynamique.
function sanitizeLiveYb(odds) {
  const out = {};
  for (const [k, v] of Object.entries(odds || {})) {
    // Marchés à ligne dynamique en live : totaux + team totals + handicap
    if (/^(match_over|match_under|ht_over|ht_under|h2_over|h2_under|cor_over|cor_under|cor_ht_over|cor_ht_under)_/.test(k)) continue;
    if (/^tt_(home|away)_(over|under)_/.test(k)) continue;
    if (/^(ht_|h2_)?tt_(home|away)_(over|under)_/.test(k)) continue;
    // Handicap peut aussi être ajusté en live selon les books, mais moins souvent
    // → on garde pour l'instant.
    out[k] = v;
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
