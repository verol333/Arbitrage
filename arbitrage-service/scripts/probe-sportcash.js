// Explore les endpoints Sportcash pour trouver un moyen de lister plus de matchs.
// Test de plusieurs endpoints en séquence et report des tailles de réponse.

import { xget } from '../../src/bookmakers/sportcash/api.js';

const candidates = [
  ['getWidgetCentrali', {}],
  ['getHomeLandingData', { timezone: '1' }],
  ['getSchedaAvvenimentiInAggregata', { pal: '26300', idAggregata: '-1' }],
  ['getSchedaAvvenimentiInPalinsesto', { pal: '26300' }],
  ['getPalinsestiAttivi', {}],
  ['getPalinsestoBySport', { sportCode: 'FT' }],
  ['getEventiInPalinsestoBySport', { pal: '26300', sportCode: 'FT' }],
  ['getAvvenimentiInPalinsesto', { pal: '26300' }],
  ['getAvvenimenti', { pal: '26300' }],
  ['getLandingDataByCanale', { canale: '1' }],
  ['getMatchListBySport', { sportCode: 'FT' }],
  ['getEventiByPalinsestoAndSport', { pal: '26300', sport: 'Football' }],
  ['getScommessePalinsestoBySport', { pal: '26300', sport: 'Football' }],
];

(async () => {
  const out = { at: new Date().toISOString(), tests: [] };
  for (const [ep, params] of candidates) {
    process.stderr.write(`[probe] ${ep}...\n`);
    try {
      const r = await xget(ep, params, 15_000);
      const info = {
        endpoint: ep,
        params,
        ok: r != null,
        type: Array.isArray(r) ? 'array' : typeof r,
        size: Array.isArray(r) ? r.length : (r ? Object.keys(r).length : 0),
        keys: r && typeof r === 'object' && !Array.isArray(r) ? Object.keys(r).slice(0, 15) : null,
        sample: Array.isArray(r) ? r.slice(0, 1) : null,
      };
      out.tests.push(info);
    } catch (e) { out.tests.push({ endpoint: ep, error: e.message }); }
  }
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
