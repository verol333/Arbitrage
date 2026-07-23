// Test du proxy Cloudflare Worker avec YellowBet et PremierBet.
// Usage : CF_WORKER_PROXY_URL=https://arb-proxy.xxx.workers.dev node scripts/test-proxy.js

const WORKER = process.env.CF_WORKER_PROXY_URL;
if (!WORKER) {
  console.error('CF_WORKER_PROXY_URL non defini. Lance avec :');
  console.error('  CF_WORKER_PROXY_URL=https://arb-proxy.xxx.workers.dev node scripts/test-proxy.js');
  process.exit(1);
}

async function testWorker(name, targetUrl, forwardHeaders = {}) {
  console.log(`\n--- ${name} ---`);
  const url = `${WORKER}/?url=${encodeURIComponent(targetUrl)}`;
  const headers = {};
  for (const [k, v] of Object.entries(forwardHeaders)) {
    headers[`x-forward-${k}`] = v;
  }
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(25000) });
    const t = await r.text();
    console.log(`Status: ${r.status}`);
    if (r.ok && t) {
      try {
        const j = JSON.parse(t);
        const events = Array.isArray(j?.data) ? j.data : [];
        console.log(`Matchs recus: ${events.length}`);
        if (events.length > 0) {
          const e = events[0];
          console.log(`Premier: ${e.h || e.home_team} vs ${e.a || e.away_team} | ${e.ln || e.league}`);
          console.log(`Marches: ${e.bts?.length || e.odds?.length || 'N/A'}`);
        }
        console.log('RESULTAT: OK');
      } catch {
        console.log(`Reponse (${t.length} chars): ${t.substring(0, 200)}`);
        console.log('RESULTAT: Reponse non-JSON (probablement page Cloudflare)');
      }
    } else {
      console.log(`Reponse: ${t.substring(0, 200)}`);
      console.log('RESULTAT: ECHEC');
    }
  } catch (e) {
    console.log(`Erreur: ${e.message}`);
    console.log('RESULTAT: ECHEC');
  }
}

const now = new Date();
const to = new Date(now.getTime() + 72 * 3600 * 1000);
const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

// Test 1 : YellowBet (Cloudflare, headers requis)
await testWorker(
  'YellowBet evapi',
  `https://yellowbet.cg/services/evapi/event/GetEvents?sportIds=31&fromDate=${iso(now)}&toDate=${iso(to)}`,
  { brandid: '122', channelid: '4', language: 'fr', terminal: 'yellowbet.cg' }
);

// Test 2 : PremierBet (Cloudflare)
await testWorker(
  'PremierBet',
  'https://www.premierbet.cg/api/offering/v2018/premierbet/offered.json?lang=fr&market=FR&brandId=2093&countryId=CG&sportId=1',
  {}
);

// Test 3 : AllOrigins fallback pour YellowBet
console.log('\n--- AllOrigins fallback (YellowBet) ---');
try {
  const url = `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://yellowbet.cg/services/evapi/event/GetEvents?sportIds=31&fromDate=${iso(now)}&toDate=${iso(to)}`)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const t = await r.text();
  console.log(`Status: ${r.status}`);
  try {
    const j = JSON.parse(t);
    console.log(`Matchs: ${j?.data?.length || 0}`);
    console.log('RESULTAT: OK');
  } catch {
    console.log(`Reponse: ${t.substring(0, 200)}`);
    console.log('RESULTAT: ECHEC (AllOrigins ne transmet pas les headers customs)');
  }
} catch (e) {
  console.log(`Erreur: ${e.message}`);
}

console.log('\n=== RESUME ===');
console.log('Si YellowBet via Worker = OK -> tout est bon, pas besoin de Jina');
console.log('Si YellowBet via Worker = ECHEC -> on devra garder Jina uniquement pour YellowBet/PremierBet');
