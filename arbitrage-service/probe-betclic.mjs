// Sonde jetable Betclic (CI/SN/FR) : site, API offer (begmedia), bundles. A supprimer.
import { gotScraping } from 'got-scraping';
const keys = ['begmedia','offer.cdn','globalapi','betclic-api','graphql','__NUXT__','__NEXT_DATA__','sitecode','countrycode','wss://','signalr','akamai','cloudflare','incapsula','datadome','perimeterx'];
async function get(u, extra = {}) {
  const r = await gotScraping({ url: u, headerGeneratorOptions: { browsers: ['chrome'], devices: ['mobile'], locales: ['fr-FR'] }, headers: extra, timeout: { request: 30000 }, throwHttpErrors: false });
  return { status: r.statusCode, body: r.body || '', url: r.url, h: r.headers };
}
const pages = ['https://www.betclic.ci/', 'https://m.betclic.ci/', 'https://www.betclic.sn/', 'https://www.betclic.fr/'];
for (const u of pages) {
  try {
    const r = await get(u);
    console.log('--- PAGE', u, r.status, 'len=' + r.body.length, 'final=' + r.url, 'server=' + (r.h['server']||''), 'cf=' + (r.h['cf-ray']?'yes':'no'), 'via=' + (r.h['via']||''), 'x-cache=' + (r.h['x-cache']||''));
    if (r.status !== 200) { console.log(r.body.replace(/\s+/g,' ').slice(0, 400)); continue; }
    console.log('indices:', keys.filter((k) => new RegExp(k, 'i').test(r.body)).join(', '));
    const hosts = [...new Set([...r.body.matchAll(/https?:\/\/[a-z0-9.\-]+/gi)].map((m) => m[0]))].slice(0, 40);
    console.log('hosts:', JSON.stringify(hosts));
    const src = [...r.body.matchAll(/(?:src|href)="([^"]+\.js[^"]*)"/g)].map((m) => m[1]).slice(0, 12);
    console.log('bundles:', JSON.stringify(src));
    for (const s of src.slice(0, 6)) {
      const abs = s.startsWith('http') ? s : new URL(s, r.url).href;
      try {
        const b = (await get(abs)).body;
        const api = [...new Set([...b.matchAll(/https?:\/\/[a-z0-9.\-]+(?:\/[a-z0-9\/_\-.{}]*)?(?:api|offer|odds|sports|events)[a-z0-9\/_\-.{}]*/gi)].map((m) => m[0]))].slice(0, 20);
        const paths = [...new Set([...b.matchAll(/["'](\/?api\/[a-z0-9\/_\-.{}]+)["']/gi)].map((m) => m[1]))].slice(0, 25);
        console.log('  bundle', abs.slice(-60), 'len=' + b.length, '| indices:', keys.filter((k) => new RegExp(k, 'i').test(b)).join(','), '| api:', JSON.stringify(api), '| paths:', JSON.stringify(paths));
      } catch (e) { console.log('  bundle KO', abs.slice(-40), e.message); }
    }
  } catch (e) { console.log('--- PAGE', u, 'KO', e.message); }
}
const apis = [
  'https://offer.cdn.begmedia.com/api/pub/v2/sports?application=2&countrycode=ci&language=fr&sitecode=cifr',
  'https://offer.cdn.begmedia.com/api/pub/v4/sports/1?application=2&countrycode=ci&language=fr&sitecode=cifr&limit=3',
  'https://offer.cdn.begmedia.com/api/pub/v4/sports/1?application=2&countrycode=fr&language=fr&sitecode=frfr&limit=3',
  'https://offer.cdn.begmedia.com/api/pub/v4/sports/1?application=2&countrycode=sn&language=fr&sitecode=snfr&limit=3',
  'https://globalapi.begmedia.com/api/pub/v2/sports?application=2&countrycode=ci&language=fr&sitecode=cifr',
];
for (const u of apis) {
  try { const r = await get(u, { origin: 'https://www.betclic.ci', referer: 'https://www.betclic.ci/' }); console.log('--- API', u.slice(0, 110), r.status, 'len=' + r.body.length, '|', r.body.replace(/\s+/g,' ').slice(0, 500)); }
  catch (e) { console.log('--- API', u.slice(0, 110), 'KO', e.message); }
}
