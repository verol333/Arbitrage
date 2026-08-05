#!/usr/bin/env node
// Probe Maxibet v4 — dump HTML + scripts inline dans stdout (le workflow
// tee dans probe-results/probe-tenerife.log qui sera commit auto).
const JINA = process.env.JINA_API_KEY || '';
async function fetchJina(url) {
  try {
    const r = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Authorization: JINA ? `Bearer ${JINA}` : '',
        'X-Return-Format': 'html',
        'X-Respond-With': 'html',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(30000),
    });
    return { status: r.status, text: r.ok ? await r.text() : '' };
  } catch (e) { return { status: 0, err: e.message, text: '' }; }
}

console.log('═══ HOME HTML ═══');
const home = await fetchJina('https://m.maxibet.bet/');
console.log(`status=${home.status} bytes=${home.text.length}`);
console.log('\n---HTML-START---');
console.log(home.text);
console.log('---HTML-END---\n');

const scripts = new Set();
for (const m of home.text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) scripts.add(m[1]);
console.log(`\n═══ SCRIPTS (${scripts.size}) ═══`);
console.log([...scripts].join('\n'));

// Fetch chaque script — dump les 200 premiers ko de chacun (limite total ~2MB de log)
let idx = 0;
for (const src of scripts) {
  const url = src.startsWith('http') ? src : `https://m.maxibet.bet${src.startsWith('/') ? '' : '/'}${src}`;
  const r = await fetchJina(url);
  console.log(`\n═══ SCRIPT ${idx}: ${url} (${r.status}, ${r.text.length}b) ═══`);
  console.log('---JS-START---');
  console.log(r.text.slice(0, 200_000));
  if (r.text.length > 200_000) console.log(`... (tronque ${r.text.length - 200_000}b restants)`);
  console.log('---JS-END---');
  idx++;
}

// Endpoints candidats
console.log('\n═══ API CANDIDATES ═══');
for (const url of [
  'https://m.maxibet.bet/api/v1/sports',
  'https://m.maxibet.bet/api/sports',
  'https://statistics.maxibet.bet/',
  'https://m.maxibet.bet/config.js',
  'https://m.maxibet.bet/config.json',
]) {
  const r = await fetchJina(url);
  console.log(`${url} → ${r.status} ${r.text.length}b`);
  if (r.text && r.text.length < 5000) console.log('  ' + r.text.slice(0, 500));
}
