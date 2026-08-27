// SONDE : trouver une source OFFICIELLE des libelles de marches 1xbet.
// On ne devine rien : on interroge le bookmaker et on imprime ce qu'il renvoie.
// Deux pistes testees :
//   A. endpoints "dictionnaire" (liste de types de paris)
//   B. structure brute d'un match (toutes les cles presentes dans GE/E)
import { viaWorker, FEED, COUNTRY, PARTNER } from '../src/bookmakers/xbet/api.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CANDIDATES = [
  '/service-api/LineFeed/GetBetTypes?lng=fr',
  '/service-api/LineFeed/GetBetTypesZip?lng=fr',
  '/service-api/LineFeed/GetGroupsZip?lng=fr',
  '/service-api/LineFeed/GetGroups?lng=fr&sport=1',
  '/service-api/LineFeed/GetMarketsGroups?lng=fr&sportId=1',
  '/service-api/LineFeed/GetEventTypes?lng=fr',
  '/service-api/LineFeed/GetEventsNames?lng=fr',
  '/service-api/LineFeed/GetDictionary?lng=fr',
  '/service-api/dictionary/GetBetTypes?lng=fr',
  '/service-api/dictionary/v1/betTypes?lng=fr',
  '/service-api/betting/dictionary/betTypes?lng=fr',
  '/service-api/LineFeed/GetSportsShortZip?lng=fr&country=' + COUNTRY,
  '/genfiles/cms/betstypes/fr.json',
  '/genfiles/dictionary/fr/betTypes.json',
];

async function probeDictionaries() {
  console.log('== A. endpoints dictionnaire ==');
  for (const p of CANDIDATES) {
    let verdict;
    try {
      const j = await viaWorker(FEED + p);
      if (!j) verdict = 'aucune reponse exploitable';
      else if (typeof j === 'string') verdict = 'texte (' + j.slice(0, 60) + ')';
      else {
        const val = j.Value ?? j;
        const n = Array.isArray(val) ? val.length : Object.keys(val || {}).length;
        verdict = 'JSON ok | cles=' + Object.keys(j).slice(0, 6).join(',') + ' | taille=' + n +
          ' | echantillon=' + JSON.stringify(Array.isArray(val) ? val.slice(0, 2) : val).slice(0, 300);
      }
    } catch (e) { verdict = 'erreur ' + e.message; }
    console.log('  ' + p + ' -> ' + verdict);
    await sleep(1500);
  }
}

async function probeGameStructure() {
  console.log('\n== B. structure brute d un match ==');
  const list = await viaWorker(FEED + '/service-api/LineFeed/Get1x2_VZip?sports=1&count=5&lng=fr&mode=4&country=' + COUNTRY + '&partner=' + PARTNER + '&getEmpty=true');
  const ev = (list?.Value || [])[0];
  if (!ev) { console.log('  aucun match dans le flux'); return; }
  console.log('  match ' + ev.I + ' : ' + ev.O1 + ' - ' + ev.O2);
  await sleep(1500);
  const url = FEED + '/service-api/LineFeed/GetGameZip?id=' + ev.I +
    '&lng=fr&isSubGames=true&GroupEvents=true&countevents=250&partner=' + PARTNER +
    '&grMode=4&marketType=1&country=' + COUNTRY;
  const j = await viaWorker(url);
  const V = j?.Value;
  if (!V) { console.log('  pas de detail match'); return; }
  console.log('  cles racine : ' + Object.keys(V).join(','));
  const ge = V.GE || [];
  console.log('  nb groupes : ' + ge.length);
  const groupKeys = new Set(), eventKeys = new Set();
  for (const g of ge) {
    Object.keys(g).forEach((k) => groupKeys.add(k));
    for (const sub of g.E || []) for (const it of (Array.isArray(sub) ? sub : [sub])) Object.keys(it).forEach((k) => eventKeys.add(k));
  }
  console.log('  cles de groupe : ' + [...groupKeys].join(','));
  console.log('  cles d issue  : ' + [...eventKeys].join(','));
  console.log('  groupe brut #1 : ' + JSON.stringify(ge[0]).slice(0, 500));
  // Inventaire (G, nb issues, T presents, P presents) pour les gros groupes
  console.log('\n  inventaire des groupes (G | issues | T | P) :');
  const rows = ge.map((g) => {
    const items = (g.E || []).flatMap((s) => (Array.isArray(s) ? s : [s]));
    const ts = [...new Set(items.map((i) => i.T))].slice(0, 12);
    const ps = [...new Set(items.map((i) => i.P).filter((v) => v != null))].slice(0, 8);
    return { G: g.G, n: items.length, ts, ps };
  }).sort((a, b) => b.n - a.n);
  for (const r of rows) console.log('    G' + r.G + ' | ' + r.n + ' issues | T=[' + r.ts.join(',') + '] | P=[' + r.ps.join(',') + ']');
}

await probeDictionaries();
await probeGameStructure();
