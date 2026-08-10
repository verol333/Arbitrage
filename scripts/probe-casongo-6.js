#!/usr/bin/env node
// PROBE CASONGO #6 — dump structure catégorie foot depuis GetPrematchTree.

const TOKEN = 'NWI1Mzg3NWNjMDVhNGE3NmEwMTBmM2FiYTU5MWU1NTAuMi4xNzg2MzY4NTc0LjE3ODg5NjA1NzQ.iS2kU2nL0H_9-F2XwGrNF5Yc7SptnajlLI-WoBmcCMw';
const SCRAPE_DO_KEY = process.env.SCRAPE_DO_KEY || '';

function browserHeaders() {
  return {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'fr-FR,fr;q=0.8',
    authorization: `Bearer ${TOKEN}`,
    'content-type': 'application/json',
    origin: 'https://launcher.velisports.com',
    referer: 'https://launcher.velisports.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    'vsb-integration-token': '',
    'vsb-start-time': new Date().toISOString(),
    'vsb-trace-id': 'TRACEWEBAPPproduction' + Math.random().toString(36).slice(2, 22),
  };
}

async function sd(target) {
  const proxied = `https://api.scrape.do/?token=${SCRAPE_DO_KEY}&url=${encodeURIComponent(target)}&customHeaders=true&super=true&geoCode=us`;
  try {
    const res = await fetch(proxied, { signal: AbortSignal.timeout(60_000), headers: browserHeaders() });
    return { status: res.status, body: await res.text() };
  } catch (e) { return { status: 0, body: null, err: e.message }; }
}

const QS = 'CurrencyId=XAF&LanguageId=fr&PartnerId=2&PartnerName=casongo&TimeZone=1';
const BASE = 'https://prod-api.velisports.com/websitewebapi';

// ═════ 1. Dump PrematchTree foot ═════
console.log('══ 1. GetPrematchTree structure foot ══\n');
const tree = await sd(`${BASE}/WebSite/GetPrematchTree?SportId=1&${QS}`);
console.log(`Status: ${tree.status}, len: ${tree.body?.length}`);

let parsed = null;
try { parsed = JSON.parse(tree.body); } catch (e) { console.log('parse err:', e.message); process.exit(1); }

const footballSport = parsed.Ss?.find((s) => s.SI === 1);
if (!footballSport) { console.log('Pas de Ss.SI=1 (Football)'); process.exit(1); }

console.log(`\n🏆 Football: ${footballSport.SN}, ${footballSport.Rs?.length} régions`);
console.log(`Sport keys: ${Object.keys(footballSport).join(', ')}`);

// Iterate all régions, count matchs
let totalCats = 0;
let totalMatches = 0;
const sampleCat = { ri: null, rn: null, ci: null, cn: null, keys: null, matchesKey: null, sampleMatch: null };
for (const r of footballSport.Rs || []) {
  for (const c of r.Cs || []) {
    totalCats++;
    // Chercher clé qui ressemble à un array de matchs
    for (const k of Object.keys(c)) {
      const v = c[k];
      if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && (v[0].MI || v[0].EId || v[0].TN || v[0].Cs)) {
        totalMatches += v.length;
        if (!sampleCat.ci) {
          sampleCat.ri = r.RI; sampleCat.rn = r.RN; sampleCat.ci = c.CI; sampleCat.cn = c.CN;
          sampleCat.keys = Object.keys(c); sampleCat.matchesKey = k; sampleCat.sampleMatch = v[0];
        }
      }
    }
  }
}
console.log(`\n📊 Total: ${totalCats} catégories, ${totalMatches} matchs trouvés dans l'arbre`);

if (sampleCat.ci) {
  console.log(`\n📁 Exemple catégorie: [${sampleCat.ri}] ${sampleCat.rn} > [${sampleCat.ci}] ${sampleCat.cn}`);
  console.log(`   Category keys: ${sampleCat.keys.join(', ')}`);
  console.log(`   Matches sous clé: '${sampleCat.matchesKey}'`);
  console.log(`   Match keys: ${Object.keys(sampleCat.sampleMatch).join(', ')}`);
  console.log(`\n   Sample match FULL:\n${JSON.stringify(sampleCat.sampleMatch, null, 2).slice(0, 2000)}`);
} else {
  console.log('\n⚠️ Aucun match trouvé dans l\'arbre → il faut un appel par catégorie');
  const firstCat = footballSport.Rs?.[0]?.Cs?.[0];
  if (firstCat) {
    console.log(`\n📁 Première catégorie (sans matchs directs):`);
    console.log(`   [${firstCat.CI}] ${firstCat.CN}`);
    console.log(`   Keys: ${Object.keys(firstCat).join(', ')}`);
    console.log(`\n   FULL:\n${JSON.stringify(firstCat, null, 2).slice(0, 1500)}`);

    // Test endpoints matchs par CategoryId
    console.log('\n══ 2. Test endpoints matchs par CategoryId ══\n');
    const cid = firstCat.CI;
    const cats = [
      `${BASE}/WebSite/GetCategoryMatches?CategoryId=${cid}&${QS}`,
      `${BASE}/WebSite/GetMatchesByCategory?CategoryId=${cid}&${QS}`,
      `${BASE}/WebSite/GetCategoryEvents?CategoryId=${cid}&${QS}`,
      `${BASE}/WebSite/GetMatchesByCategoryId?CategoryId=${cid}&${QS}`,
      `${BASE}/WebSite/GetCategoryPrematchMatches?CategoryId=${cid}&${QS}`,
      `${BASE}/WebSite/GetPrematchCategoryMatches?CategoryId=${cid}&${QS}`,
      `${BASE}/WebSite/GetMatchesByLeague?LeagueId=${cid}&${QS}`,
      `${BASE}/WebSite/GetMatches?CategoryId=${cid}&${QS}`,
    ];
    for (const u of cats) {
      const r = await sd(u);
      const status = r.status === 200 ? '✅' : `⚠️ ${r.status}`;
      console.log(`  [${status}] len=${r.body?.length || 0} ${u.split('?')[0].split('/').pop()}`);
      if (r.status === 200 && r.body?.length > 100 && r.body.length < 20000) {
        try {
          const j = JSON.parse(r.body);
          if (Array.isArray(j)) console.log(`     Array[${j.length}] first=${JSON.stringify(j[0]).slice(0, 400)}`);
          else console.log(`     keys=${Object.keys(j).slice(0, 10).join(', ')}`);
        } catch {}
      }
    }
  }
}

console.log('\n▶ Fin.');
process.exit(0);
