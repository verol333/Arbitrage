// Probe BetPawa : tente plusieurs domaines + endpoints connus pour découvrir
// l'API cotes. BetPawa a un domaine par pays (cg/ci/ug/ke/gh/ng/rw/tz/mw/zm).
// Objectif : identifier le premier couple {domain, endpoint} qui renvoie du JSON.
const DOMAINS = ['cg', 'ci', 'ug', 'ke', 'gh', 'ng', 'rw', 'tz', 'mw', 'zm'];
const CANDIDATES = [
  // Endpoints v3 sportsbook (usual BetPawa pattern)
  { path: '/api/sportsbook/v3/events/list/by-category?categoryId=1&marketId=1X2&take=50', label: 'v3/events/list' },
  { path: '/api/sportsbook/v3/events/upcoming/football?take=50', label: 'v3/events/upcoming' },
  // Sportsbook prematch
  { path: '/api/sportsbook/prematch/events?sportId=1&take=50', label: 'prematch/events' },
  { path: '/api/sportsbook/prematch/highlights?sportId=1&take=50', label: 'prematch/highlights' },
  // Query API
  { path: '/api/query/prematch/events?sportId=1', label: 'query/prematch/events' },
  { path: '/api/query/prematch/football/events', label: 'query/football/events' },
  // GraphQL possibly
  { path: '/api/graphql', label: 'graphql' },
  // v2 pattern
  { path: '/api/sportsbook/v2/events?sportId=1&take=50', label: 'v2/events' },
];

const HDR = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
  'X-Pawa-Language': 'fr',
  'X-Pawa-Brand': 'betpawa-congo',
};

async function tryOne(url) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      headers: HDR,
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    });
    const ct = res.headers.get('content-type') || '';
    let bodyLen = 0, sample = '', isJson = false, itemCount = null;
    if (ct.includes('json')) {
      isJson = true;
      const text = await res.text();
      bodyLen = text.length;
      sample = text.slice(0, 300);
      try {
        const j = JSON.parse(text);
        // Try to count events/items in common structures
        if (Array.isArray(j)) itemCount = j.length;
        else if (Array.isArray(j?.data)) itemCount = j.data.length;
        else if (Array.isArray(j?.events)) itemCount = j.events.length;
        else if (Array.isArray(j?.result?.items)) itemCount = j.result.items.length;
        else if (Array.isArray(j?.responses?.[0]?.responses)) itemCount = j.responses[0].responses.length;
      } catch { /* ignore */ }
    } else {
      const text = await res.text();
      bodyLen = text.length;
      sample = text.slice(0, 200).replace(/\s+/g, ' ');
    }
    return { status: res.status, ct, bodyLen, isJson, itemCount, sample, elapsed: Date.now() - start };
  } catch (e) {
    return { error: e.message, elapsed: Date.now() - start };
  }
}

console.log('=== BETPAWA PROBE : domaines × endpoints ===\n');

const hits = [];
for (const cc of DOMAINS) {
  const base = `https://www.betpawa.${cc}`;
  for (const c of CANDIDATES) {
    const url = `${base}${c.path}`;
    const r = await tryOne(url);
    const ok = r.status === 200 && r.isJson && (r.itemCount == null || r.itemCount > 0);
    const marker = ok ? '✅' : (r.status === 200 ? '⚠️' : '❌');
    console.log(`${marker} ${cc.padEnd(3)} ${c.label.padEnd(30)} status=${r.status ?? 'ERR'} ct=${(r.ct || '').slice(0, 20)} len=${r.bodyLen ?? '?'} items=${r.itemCount ?? '?'} elapsed=${r.elapsed}ms`);
    if (r.error) console.log(`    err=${r.error}`);
    else if (ok) console.log(`    sample: ${r.sample.slice(0, 200)}`);
    if (ok) hits.push({ cc, label: c.label, url, itemCount: r.itemCount });
  }
  // Only continue to next domain if current failed everywhere (save time)
  if (hits.some(h => h.cc === cc)) break;
}

console.log('\n=== HITS ===');
for (const h of hits) console.log(`  ${h.cc} : ${h.label} → ${h.url} (items=${h.itemCount})`);
if (!hits.length) console.log('  AUCUN endpoint accessible — headers ou domaine à revoir');

process.exit(0);
