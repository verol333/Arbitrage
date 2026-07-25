// Probe v2 winner.bet : passe Cloudflare via got-scraping et inspecte tout le HTML.
import { gotScraping } from 'got-scraping';

const CHROME_OPTS = {
  browsers: [{ name: 'chrome', minVersion: 114, maxVersion: 126 }],
  devices: ['desktop'],
  locales: ['fr-FR', 'en-US'],
  operatingSystems: ['linux'],
};

async function stealth(url, opts = {}) {
  try {
    const res = await gotScraping({
      url,
      headers: opts.headers || {},
      headerGeneratorOptions: CHROME_OPTS,
      timeout: { request: opts.timeoutMs || 20000 },
      retry: { limit: 1 },
      throwHttpErrors: false,
    });
    return { status: res.statusCode, ctype: res.headers['content-type'] || '', body: res.body || '', size: (res.body || '').length };
  } catch (e) { return { error: e.message }; }
}

const results = {};

// 1) Home
const home = await stealth('https://winner.bet/fr/');
results.home_status = home.status;
results.home_size = home.size;
if (home.body) {
  // Extract API-looking URLs anywhere in HTML
  const apiHints = [...new Set([...home.body.matchAll(/https?:\/\/[a-zA-Z0-9.-]+\/[^\s"'<>]*?(?:api|rest|feed|sport|betting|events|matches|graphql|bo\/[a-z]+|prematch|live)[^\s"'<>]*/gi)].map((m) => m[0]))].slice(0, 30);
  // Also common tokens (window.CONFIG, __NEXT_DATA__, apiBase, etc)
  const configHints = [];
  const patterns = [
    /window\.__CONFIG__\s*=\s*(\{[^<]{0,1000})/gi,
    /window\.__ENV__\s*=\s*(\{[^<]{0,1000})/gi,
    /"apiUrl"\s*:\s*"([^"]+)"/gi,
    /"apiBase"\s*:\s*"([^"]+)"/gi,
    /"backendUrl"\s*:\s*"([^"]+)"/gi,
    /"graphqlUrl"\s*:\s*"([^"]+)"/gi,
    /"wsUrl"\s*:\s*"([^"]+)"/gi,
    /wss?:\/\/[a-zA-Z0-9.-]+[^\s"'<>]*/gi,
  ];
  for (const p of patterns) {
    const matches = [...home.body.matchAll(p)].slice(0, 5);
    for (const m of matches) configHints.push(m[0].slice(0, 200));
  }
  results.api_hints = apiHints;
  results.config_hints = configHints;
  // Scripts
  const scripts = [...home.body.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]).slice(0, 15);
  results.scripts = scripts;
  // Look for well-known BI vendors
  results.tech_hints = {
    hasNextData: /__NEXT_DATA__/i.test(home.body),
    hasNuxtData: /window\.__NUXT__/i.test(home.body),
    hasReact: /react/i.test(home.body),
    hasAngular: /ng-app|angular/i.test(home.body),
    hasBetradar: /betradar/i.test(home.body),
    hasBetgenius: /betgenius/i.test(home.body),
    hasSbtech: /sbtech/i.test(home.body),
    hasPlaytech: /playtech/i.test(home.body),
    hasSportsBookIo: /sportsbook\.io/i.test(home.body),
    hasKambi: /kambi/i.test(home.body),
    hasBragg: /bragg/i.test(home.body),
    hasStake: /stake\.com/i.test(home.body),
    hasBetconstruct: /betconstruct/i.test(home.body),
    hasSoftswiss: /softswiss/i.test(home.body),
    hasFsb: /fsbtech|fsb\.co/i.test(home.body),
  };
}

// 2) Try common endpoints via stealth (Cloudflare bypass)
const guesses = [
  'https://winner.bet/api/v1/sports',
  'https://winner.bet/api/sports',
  'https://winner.bet/api/events',
  'https://winner.bet/rest/sports',
  'https://winner.bet/rest/events',
  'https://winner.bet/bo/api/sports',
  'https://winner.bet/api/sportsbook/prematch',
  'https://winner.bet/api/sportsbook/live',
  'https://winner.bet/api/prematch',
  'https://winner.bet/api/live',
  'https://api.winner.bet/sports',
  'https://api.winner.bet/events',
];
results.endpoints = {};
for (const u of guesses) {
  const r = await stealth(u, { headers: { Accept: 'application/json, text/plain, */*' } });
  if (r.status && r.status !== 403 && r.status !== 404) {
    let json = null;
    try { json = JSON.parse(r.body); } catch { /* not json */ }
    results.endpoints[u] = { status: r.status, ctype: r.ctype, size: r.size, json_keys: json ? Object.keys(json).slice(0, 15) : null, sample: r.body.slice(0, 400) };
  } else if (r.status) {
    results.endpoints[u] = { status: r.status };
  } else {
    results.endpoints[u] = { error: r.error };
  }
}

console.log('=== WINNER PROBE V2 START ===');
console.log(JSON.stringify(results, null, 2));
console.log('=== WINNER PROBE V2 END ===');
process.exit(0);
