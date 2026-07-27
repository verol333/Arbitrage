#!/usr/bin/env node
// Sonde des endpoints Sportcash XSportDatastore pour trouver un catalogue
// COMPLET des matchs foot du jour (au-dela des widgets home).
//
// Le connecteur actuel utilise getWidgetCentrali + getHomeLandingData → 3-7
// matchs (widgets promus). Objectif : trouver l'endpoint "getPalinsesto" /
// "getEventiSport" / "getListaEventi" qui liste TOUS les matchs foot.

const BASE = 'https://sportcash.ci/XSportDatastore';
const COMMON = { systemCode: 'SPORTCASH', lingua: 'FR', hash: '' };
const HDR = {
  'user-agent': 'Mozilla/5.0',
  accept: 'application/json, text/plain, */*',
  referer: 'https://sportcash.ci/',
};

async function probe(endpoint, params = {}) {
  const qs = new URLSearchParams({ ...COMMON, ...params }).toString();
  const url = `${BASE}/${endpoint}?${qs}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: HDR });
    const body = await res.text();
    const dur = Date.now() - t0;
    if (res.status !== 200) return { endpoint, params, status: res.status, dur, size: body.length };
    let j = null;
    try { j = JSON.parse(body); } catch { return { endpoint, params, status: 200, dur, size: body.length, note: 'non-JSON' }; }
    const keys = Object.keys(j || {}).slice(0, 8);
    // Compteurs sur les champs communs
    const counts = {};
    for (const k of ['avs', 'tms', 'lms', 'evs', 'events', 'palinsesto', 'scs', 'lista', 'items', 'data', 'result']) {
      if (Array.isArray(j?.[k])) counts[k] = j[k].length;
      else if (j?.[k] && typeof j[k] === 'object') counts[k] = `obj(keys=${Object.keys(j[k]).length})`;
    }
    // Cherche recursivement les objets qui ressemblent a des events foot
    let footballCount = 0;
    const walk = (v, depth = 0) => {
      if (depth > 4 || !v) return;
      if (Array.isArray(v)) { for (const x of v.slice(0, 200)) walk(x, depth + 1); return; }
      if (typeof v === 'object') {
        if (v.ds === 'Football' || v.disport === 'Football' || v.sn === 'Football') footballCount++;
        for (const val of Object.values(v)) walk(val, depth + 1);
      }
    };
    walk(j);
    return { endpoint, params, status: 200, dur, size: body.length, keys, counts, footballCount };
  } catch (e) {
    return { endpoint, params, status: 0, dur: Date.now() - t0, err: e.message };
  }
}

const ENDPOINTS = [
  // Vraisemblables (naming XSport italien)
  ['getPalinsesto', { idSport: '1' }],
  ['getPalinsesto', { idSport: '1', prematch: 'true' }],
  ['getPalinsesto', { idSport: '1', giorno: '0' }],
  ['getEventiSport', { idSport: '1' }],
  ['getEventiSport', { idSport: '1', giorno: '0' }],
  ['getEventiPerSport', { idSport: '1' }],
  ['getListaEventi', { idSport: '1' }],
  ['getListaEventi', { idSport: '1', prematch: 'true' }],
  ['getEventiPrematch', { idSport: '1' }],
  ['getEventiCalendario', { idSport: '1' }],
  ['getCalendarioSport', { idSport: '1' }],
  ['getEventiPromossi', {}],
  ['getManifestazioni', { idSport: '1' }],
  ['getListaManifestazioni', { idSport: '1' }],
  ['getAvvenimenti', { idSport: '1' }],
  ['getAvvenimentiSport', { idSport: '1' }],
  // Endpoints deja utilises (baseline)
  ['getWidgetCentrali', {}],
  ['getHomeLandingData', { timezone: '1' }],
];

(async () => {
  console.log('=== SPORTCASH CATALOG PROBE ===');
  const results = [];
  for (const [ep, params] of ENDPOINTS) {
    const r = await probe(ep, params);
    console.log(JSON.stringify(r));
    results.push(r);
  }
  console.log('\n--- SUMMARY (endpoints avec Football count > 10) ---');
  const winners = results.filter((r) => (r.footballCount || 0) > 10);
  for (const w of winners) console.log(`WINNER: ${w.endpoint}?${new URLSearchParams(w.params).toString()} → footballCount=${w.footballCount} counts=${JSON.stringify(w.counts)}`);
  if (!winners.length) console.log('(aucun endpoint ne liste > 10 events Football — a explorer plus loin)');
})();
