// P4 discovery — sport IDs Table Tennis (les 7 books restants).
// Approche : pour chaque book, tenter les IDs candidats via l'API réelle et
// compter les matchs retournés + identifier un joueur TT typique (nom court style
// "Nom, Prenom" ou joueurs asiatiques/européens).
import { viaWorker, FEED, COUNTRY, PARTNER, mapXItems } from '../src/bookmakers/xbet/api.js';
import { evapi, BASE_URL } from '../src/bookmakers/yellowbet/api.js';
import { swarmSession } from '../src/bookmakers/betmomo/api.js';
import { sbFetchUpcoming } from '../src/bookmakers/sportybet/api.js';
import { bpFetchList, buildEventsListUrl } from '../src/bookmakers/betpawa/api.js';
import { mget } from '../src/bookmakers/premierbet/api.js';

async function probeXbet(sids) {
  console.log('\n═══ 1xBet — Get1x2_VZip par sport ═══');
  for (const sid of sids) {
    try {
      const raw = await viaWorker(`${FEED}/service-api/LineFeed/Get1x2_VZip?sports=${sid}&count=50&lng=en&mode=4&country=${COUNTRY}&partner=${PARTNER}&getEmpty=true`);
      const value = raw?.Value || [];
      const items = mapXItems(value.slice(0, 3));
      const ex = items.length ? items.map((m) => `${m.home} vs ${m.away}`).slice(0, 2).join(' | ') : '(aucun)';
      console.log(`  sid=${sid}\t${value.length} matchs  ex: ${ex}`);
    } catch (e) { console.log(`  sid=${sid}\tERR ${e.message.slice(0, 100)}`); }
  }
}

async function probeYellowbet() {
  console.log('\n═══ YellowBet — GetEvents (skip=0, then filter by sid) ═══');
  try {
    const rawJson = await evapi(`${BASE_URL}/services/evapi/event/GetEvents?skip=0&take=500&languageCode=fr`);
    const events = rawJson?.data?.evs || [];
    const bySid = {};
    for (const ev of events) bySid[ev.sid] = (bySid[ev.sid] || 0) + 1;
    console.log('  Total events:', events.length);
    console.log('  Top sids observés:');
    for (const [sid, count] of Object.entries(bySid).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      const sample = events.find((e) => e.sid === Number(sid));
      console.log(`    sid=${sid}\t${count}  ex: ${sample?.n || '?'}`);
    }
    // Focus TT candidates
    for (const testSid of [320, 33, 12]) {
      const filtered = events.filter((e) => e.sid === testSid);
      const sample = filtered[0];
      console.log(`  → sid=${testSid} test: ${filtered.length} matchs  ex: ${sample?.n || '(aucun dans page 1)'}`);
    }
  } catch (e) { console.log(`  ERR ${e.message.slice(0, 100)}`); }
}

async function probeBetmomo(sids) {
  console.log('\n═══ BetMomo — SWARM query par sport.id ═══');
  for (const sid of sids) {
    try {
      const rows = await swarmSession(async (ws, submit) => {
        return submit({
          command: 'get',
          params: {
            source: 'betting',
            what: { sport: ['id', 'name'], region: ['name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'is_live'] },
            where: { sport: { id: sid } },
            limit: 20,
          },
        });
      }, { timeoutMs: 15000 });
      const games = rows?.data?.game ? Object.values(rows.data.game) : [];
      const ex = games.slice(0, 2).map((g) => `${g.team1_name} vs ${g.team2_name}`).join(' | ');
      console.log(`  sid=${sid}\t${games.length} matchs  ex: ${ex || '(vide)'}`);
    } catch (e) { console.log(`  sid=${sid}\tERR ${e.message.slice(0, 100)}`); }
  }
}

async function probeSportybet(sportIds) {
  console.log('\n═══ SportyBet — pcUpcomingEvents par sportId ═══');
  const SB_BASE = 'https://www.sportybet.com';
  for (const sid of sportIds) {
    try {
      const url = `${SB_BASE}/api/ng/factsCenter/pcUpcomingEvents?sportId=${encodeURIComponent(sid)}&marketId=1&pageSize=50&pageNum=1&_t=${Date.now()}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      const raw = await res.json().catch(() => ({}));
      let count = 0;
      let first = null;
      for (const t of (raw?.data?.tournaments || [])) {
        count += (t.events?.length || 0);
        if (!first && t.events?.length) first = t.events[0];
      }
      const label = first ? `${first.homeTeamName} vs ${first.awayTeamName}` : '(vide)';
      console.log(`  ${sid}\t${count} matchs  ex: ${label}`);
    } catch (e) { console.log(`  ${sid}\tERR ${e.message.slice(0, 100)}`); }
  }
}

async function probeOnewin(sids) {
  console.log('\n═══ 1win — API list par sportId ═══');
  const { PLATFORM, API_BASE, ORIGIN, UA } = await import('../src/bookmakers/onewin/api.js');
  for (const sid of sids) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const url = `${API_BASE}/api/matches?sportId=${sid}&startAtFrom=${now-3600}&startAtTo=${now+3*86400}&limit=50&offset=0&l=en-001&p=${PLATFORM}`;
      const res = await fetch(url, { headers: { 'User-Agent': UA, Origin: ORIGIN } });
      const raw = await res.json();
      const games = raw?.matches || raw?.games || raw?.events || raw?.data || [];
      const list = Array.isArray(games) ? games : [];
      const first = list[0];
      const label = first ? `${first.homeName || first.team1Name || '?'} vs ${first.awayName || first.team2Name || '?'}` : '(vide)';
      console.log(`  sid=${sid}\t${list.length} matchs  ex: ${label}`);
    } catch (e) { console.log(`  sid=${sid}\tERR ${e.message.slice(0, 100)}`); }
  }
}

async function probeBetpawa(catIds) {
  console.log('\n═══ BetPawa — events par categoryId ═══');
  for (const cid of catIds) {
    try {
      const url = buildEventsListUrl({ categories: [String(cid)], marketTypes: [], skip: 0, take: 30 });
      const raw = await bpFetchList(url);
      const evs = raw?.responses?.[0]?.responseBody?.events || raw?.responses?.[0]?.events || raw?.events || [];
      const first = evs[0];
      const label = first ? `${first.name || first.homeName || '?'}` : '(vide)';
      console.log(`  cid=${cid}\t${evs.length} matchs  ex: ${label}`);
    } catch (e) { console.log(`  cid=${cid}\tERR ${e.message.slice(0, 100)}`); }
  }
}

async function probePremierbet(sids) {
  console.log('\n═══ PremierBet — highlights par sportId ═══');
  for (const sid of sids) {
    try {
      const raw = await mget('/events/highlights', { sportId: String(sid) });
      const evs = raw?.data?.events || raw?.events || [];
      const first = evs[0];
      const label = first ? `${first.homeName || first.home || '?'} vs ${first.awayName || first.away || '?'} (${first.categoryName || '?'})` : '(vide)';
      console.log(`  sid=${sid}\t${evs.length} matchs  ex: ${label}`);
    } catch (e) { console.log(`  sid=${sid}\tERR ${e.message.slice(0, 100)}`); }
  }
}

async function main() {
  console.log('▶ Discovery Table Tennis sport IDs (7 books)\n');
  await probeXbet([20, 24, 22, 43, 91]);
  await probeYellowbet();
  await probeBetmomo([6, 20, 33, 7]);
  await probeSportybet(['sr:sport:20', 'sr:sport:34', '20']);
  await probeOnewin([26, 20, 24, 12]);
  await probeBetpawa([20, 453, 6, 9]);
  await probePremierbet([20, 6, 9, 32, 7]);
  console.log('\n▶ Fin.');
  process.exit(0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
