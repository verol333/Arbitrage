// Sonde jetable : identifie la technologie de bet241 (Cloudflare bloque les
// fetch bruts, on passe donc par got-scraping comme le scanner). A supprimer.
import { gotScraping } from 'got-scraping';

const keys = ['betconstruct','swarm','digitain','altenar','sbtech','everymatrix','betsy','tglab','sportsbook','__NUXT__','__NEXT_DATA__','graphql','site_id','siteId','partnerId','apiUrl','wss://','betgames','angular','vue'];

async function get(u) {
  const r = await gotScraping({ url: u, headerGeneratorOptions: { browsers: ['chrome'], devices: ['mobile'], locales: ['fr-FR'] }, timeout: { request: 30000 }, throwHttpErrors: false });
  return { status: r.statusCode, body: r.body || '', url: r.url };
}

for (const u of ['https://m.bet241.net/fr/', 'https://bet241.net/fr/']) {
  try {
    const r = await get(u);
    console.log('---', u, r.status, 'len=' + r.body.length, 'final=' + r.url);
    if (r.status !== 200) { console.log(r.body.slice(0, 300)); continue; }
    console.log('indices:', keys.filter((k) => new RegExp(k, 'i').test(r.body)).join(', '));
    const src = [...r.body.matchAll(/(?:src|href)="([^"]+\.js[^"]*)"/g)].map((m) => m[1]).slice(0, 20);
    console.log('bundles:', JSON.stringify(src));
    const apiTop = [...new Set([...r.body.matchAll(/https?:\/\/[a-z0-9.\-]+/gi)].map((m) => m[0]))].slice(0, 25);
    console.log('hosts page:', JSON.stringify(apiTop));
    for (const s of src.slice(0, 8)) {
      const abs = s.startsWith('http') ? s : new URL(s, r.url).href;
      try {
        const b = (await get(abs)).body;
        const api = [...new Set([...b.matchAll(/https?:\/\/[a-z0-9.\-]+\/[a-z0-9\/_\-.]*(api|swarm|graphql|feed)[a-z0-9\/_\-.]*/gi)].map((m) => m[0]))].slice(0, 15);
        const ws = [...new Set([...b.matchAll(/wss?:\/\/[a-z0-9.\-\/]+/gi)].map((m) => m[0]))].slice(0, 8);
        console.log('  bundle', abs.slice(-55), 'len=' + b.length, '| indices:', keys.filter((k) => new RegExp(k, 'i').test(b)).join(','), '| api:', JSON.stringify(api), '| ws:', JSON.stringify(ws));
      } catch (e) { console.log('  bundle KO', abs.slice(-40), e.message); }
    }
  } catch (e) { console.log('---', u, 'KO', e.message); }
}
