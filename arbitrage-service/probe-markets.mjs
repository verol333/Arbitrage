// Sonde de NOMS DE MARCHÉS BRUTS : liste ce que le bookmaker publie réellement
// pour un match, marché par marché, afin de repérer ce que le lecteur ignore.
import { listPrematch } from '../src/bookmakers/onewin/list.js';
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';
import { winFlatOdds } from '../src/bookmakers/onewin/parse.js';

const list = await listPrematch('football');
console.log('1win : ' + list.length + ' matchs listés');
const sample = list.slice(0, 40);
const map = await fetchOddsWS(sample.map((m) => m.id));
let withOdds = 0, shown = 0;
for (const m of sample) {
  const groups = map.get(m.id) || map.get(String(m.id));
  const names = groups ? Object.keys(groups) : [];
  if (!names.length) continue;
  withOdds++;
  if (shown >= 2) continue;
  shown++;
  const flat = winFlatOdds(groups, { home: m.home, away: m.away });
  const read = Object.keys(flat).filter((k) => k !== '_ids');
  console.log('\n--- ' + m.home + ' - ' + m.away + ' : ' + names.length + ' marchés publiés, ' + read.length + ' cotes lues');
  console.log('MARCHÉS : ' + names.join(' | '));
  const ex = {};
  for (const n of names) ex[n] = (groups[n] || []).slice(0, 4).map((o) => (o?.name ?? o?.outcome ?? '?') + '=' + o?.cf);
  console.log('ISSUES : ' + JSON.stringify(ex));
}
console.log('\nMatchs avec cotes : ' + withOdds + '/' + sample.length);
