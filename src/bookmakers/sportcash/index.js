import { listMatches } from './list.js';
import { sportcashFlatOdds } from './parse.js';

export default {
  key: 'sportcash',
  label: 'Sportcash',
  // LIVE DESACTIVE : sportcash getEvento(isLive:true) retourne 0 markets ;
  // le workaround en list.js force isLive:false, ce qui renvoie des cotes
  // PRE-MATCH. Utiliser ces cotes en LIVE creait des surebets fantomes
  // (l'engine croyait avoir des cotes fraiches alors qu'elles etaient figees
  // pre-kickoff). A reactiver quand un endpoint LIVE fiable est identifie.
  supports: { prematch: true, live: false },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    // Tennis pas encore active : le parseur sportcash utilise des cs codes
    // decouverts pour foot uniquement. Activer tennis sans mapping cs->famille
    // produirait 0 cotes (comme YB LIVE l'avait fait avec ses corners). Probe
    // requis d'abord pour lister les cs codes tennis.
    if (sport !== 'football') return [];
    if (live) return []; // securite : refuse LIVE meme si supports.live etait vrai
    return listMatches({ live, horizonHours, sport });
  },
  async getOdds(match) { return sportcashFlatOdds(match.__raw?.markets || []); },
};
