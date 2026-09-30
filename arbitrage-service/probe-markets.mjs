// Sonde hockey : groupes « total » publiés par 1win et clés tt_ produites par le lecteur.
import { listPrematch } from '../src/bookmakers/onewin/list.js';
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';
import { winFlatOdds } from '../src/bookmakers/onewin/parse.js';
const list = await listPrematch('hockey');
console.log('1win hockey : ' + list.length);
const sample = list.slice(0, 30);
const map = await fetchOddsWS(sample.map((m) => m.id));
let shown = 0;
for (const m of sample) {
  const groups = map.get(m.id) || map.get(String(m.id));
  if (!groups || shown >= 3) continue;
  shown++;
  console.log('\n--- ' + m.home + ' - ' + m.away);
  for (const n of Object.keys(groups)) if (/total/i.test(n)) console.log('GROUPE « ' + n + ' » : ' + (groups[n] || []).map((o) => (o?.name ?? o?.outcome) + '=' + o?.cf + (o?.status !== 1 ? '(s' + o?.status + ')' : '')).join(' ; '));
  const flat = winFlatOdds(groups, { home: m.home, away: m.away });
  console.log('LU tt_ : ' + JSON.stringify(Object.fromEntries(Object.entries(flat).filter(([k]) => k.startsWith('tt_')))));
}
