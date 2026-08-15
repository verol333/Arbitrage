// Confirme sport IDs TT sur 1xBet / 1win / BetMomo via hints utilisateur.
// 1xBet : sid=10 (URL 1xbet.cg/fr/line/table-tennis avec Get1x2_VZip?sports=10)
// 1win  : sid=24 (URL 1win.com/fr-CI/betting/prematch/table-tennis-24)
// BetMomo : match 30574743 → fetchMatchOdds pour récupérer sport.id numérique
import { viaWorker, FEED, COUNTRY, PARTNER, mapXItems } from '../src/bookmakers/xbet/api.js';
import { fetchMatchOdds } from '../src/bookmakers/betmomo/api.js';

async function probeXbet() {
  console.log('═══ 1xBet sid=10 (table tennis) ═══');
  const raw = await viaWorker(`${FEED}/service-api/LineFeed/Get1x2_VZip?sports=10&count=20&lng=en&mode=4&country=${COUNTRY}&partner=${PARTNER}&getEmpty=true`);
  const value = raw?.Value || [];
  console.log(`  ${value.length} matchs`);
  const items = mapXItems(value.slice(0, 5));
  for (const m of items) console.log(`  - ${m.home} vs ${m.away}  (${m.league || '?'})`);
  if (!items.length && value.length) {
    console.log('  ⚠️ mapXItems retourne vide — structure item TT différente. Raw sample:');
    const s = value[0];
    console.log('    keys:', Object.keys(s || {}).join(','));
    console.log('    O1/O2/N/L/LE:', s?.O1, '|', s?.O2, '|', s?.N || s?.n, '|', s?.L, '|', s?.LE);
  }
}

async function probeOnewin() {
  console.log('\n═══ 1win sid=24 (table tennis) ═══');
  const { PLATFORM, API_BASE, ORIGIN, UA } = await import('../src/bookmakers/onewin/api.js');
  const now = Math.floor(Date.now() / 1000);
  // Endpoint style comme foot/tennis
  const url = `${API_BASE}/api/matches?sportId=24&startAtFrom=${now - 3600}&startAtTo=${now + 3 * 86400}&limit=30&offset=0&l=en-001&p=${PLATFORM}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Origin: ORIGIN, Accept: 'application/json' } });
    const txt = await res.text();
    console.log(`  status=${res.status} bodySize=${txt.length}`);
    // 1win peut renvoyer un binaire wrapé
    try {
      const raw = JSON.parse(txt);
      const games = raw?.matches || raw?.games || raw?.events || [];
      const list = Array.isArray(games) ? games : (raw?.data?.matches || []);
      console.log(`  ${list.length} matchs`);
      for (const m of list.slice(0, 3)) {
        console.log(`  - ${m.homeName || m.team1Name || '?'} vs ${m.awayName || m.team2Name || '?'}  (id=${m.id || m.matchId})`);
      }
    } catch {
      // Chercher pattern JSON dans le body
      console.log('  Body head:', txt.slice(0, 200));
    }
  } catch (e) { console.log(`  ERR ${e.message}`); }
}

async function probeBetmomoMatch() {
  console.log('\n═══ BetMomo match 30574743 (TableTennis) ═══');
  try {
    const markets = await fetchMatchOdds('30574743');
    console.log(`  ${markets.length} markets`);
    for (const m of markets.slice(0, 8)) {
      const events = Array.isArray(m.event) ? m.event : Object.values(m.event || {});
      const first = events[0] || {};
      console.log(`  - type="${m.type}" name="${m.name || '?'}" group=${m.group_id || '?'}/${m.group_name || '?'} ${events.length} outcomes`);
      console.log(`      ex: type_1=${first.type_1 || first.type} price=${first.price} name=${first.name || ''}`);
    }
  } catch (e) { console.log(`  ERR ${e.message}`); }
}

async function probeBetmomoAllSports() {
  console.log('\n═══ BetMomo — lister tous les sports (via SWARM sport list) ═══');
  const { swarmSession } = await import('../src/bookmakers/betmomo/api.js');
  try {
    const sports = await swarmSession(async (send) => {
      const rows = await send({ sport: ['id', 'name', 'alias', 'order'] }, {});
      return rows?.sport ? Object.values(rows.sport) : [];
    }, { timeoutMs: 15000 });
    console.log(`  ${sports.length} sports totaux :`);
    for (const s of sports.slice(0, 30)) console.log(`    id=${s.id}  name="${s.name}"  alias="${s.alias || ''}"`);
    const tt = sports.find((s) => /table\s*tennis|ping.?pong/i.test(String(s.name || s.alias || '')));
    if (tt) console.log(`\n  ✅ TABLE TENNIS trouvé : id=${tt.id}  name="${tt.name}"`);
    else console.log('\n  ⚠️ Pas de TT dans la liste retournée.');
  } catch (e) { console.log(`  ERR ${e.message}`); }
}

async function main() {
  console.log('▶ TT hints validation\n');
  await probeXbet();
  await probeOnewin();
  await probeBetmomoMatch();
  await probeBetmomoAllSports();
  console.log('\n▶ Fin.');
  process.exit(0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
