// Probe : valider que Scrape.do bypass CF pour PremierBet.
// Test 3 modes progressivement pour trouver le moins cher qui marche :
//  1. Basic (1 crédit) - probablement bloqué par CF
//  2. render=true (5 crédits) - JS rendering + solve CF challenge
//  3. super=true (10-25 crédits) - IP résidentielle premium
const TOKEN = process.env.SCRAPE_DO_KEY;
if (!TOKEN) { console.log('SCRAPE_DO_KEY missing'); process.exit(1); }

const results = { attempts: [] };

async function fetchViaScrapeDo(targetUrl, params = {}) {
  const qs = new URLSearchParams({ token: TOKEN, url: targetUrl, ...params }).toString();
  const start = Date.now();
  try {
    const res = await fetch(`https://api.scrape.do/?${qs}`, {
      method: 'GET',
      // Scrape.do peut prendre 20-30s avec render
      signal: AbortSignal.timeout(60_000),
    });
    const body = await res.text();
    return {
      elapsed_ms: Date.now() - start,
      status: res.status,
      body_len: body.length,
      body_start: body.slice(0, 400).replace(/\s+/g, ' '),
      is_cloudflare: /Attention Required|Cloudflare|Just a moment|challenge-platform/i.test(body.slice(0, 5000)),
      credits_used_header: res.headers.get('scrape-do-credit-used') || res.headers.get('sd-credit-used'),
    };
  } catch (e) {
    return { elapsed_ms: Date.now() - start, error: e.message };
  }
}

const url = 'https://premierbetzone.com/';

// Mode 1 : basic
console.log('[1/3] Basic (1 credit) ...');
const r1 = await fetchViaScrapeDo(url);
results.attempts.push({ mode: 'basic', ...r1 });

// Mode 2 : render (5 credits)
console.log('[2/3] render=true (5 credits) ...');
const r2 = await fetchViaScrapeDo(url, { render: 'true' });
results.attempts.push({ mode: 'render', ...r2 });

// Mode 3 : super (10 credits) - IP résidentielle sans render
console.log('[3/3] super=true (10 credits) ...');
const r3 = await fetchViaScrapeDo(url, { super: 'true' });
results.attempts.push({ mode: 'super', ...r3 });

// Analyse
results.summary = {
  best_mode: results.attempts.find((a) => a.status === 200 && !a.is_cloudflare)?.mode || 'AUCUN',
  cheapest_working: results.attempts.filter((a) => a.status === 200 && !a.is_cloudflare)
    .sort((a, b) => ({ basic: 1, render: 5, super: 10 }[a.mode] - { basic: 1, render: 5, super: 10 }[b.mode]))[0]?.mode || 'AUCUN',
};

console.log('=== SCRAPE.DO PROBE ===');
console.log(JSON.stringify(results, null, 2));
console.log('=== END ===');
process.exit(0);
