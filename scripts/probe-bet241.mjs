// Sonde jetable : identifie la technologie de bet241 depuis un runner GitHub
// (Cloudflare bloque les IP Base44). A supprimer apres identification.
const H = { 'user-agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36', 'accept-language': 'fr' };
const urls = ['https://m.bet241.net/fr/', 'https://bet241.net/fr/', 'https://www.bet241.net/'];
for (const u of urls) {
  try {
    const r = await fetch(u, { headers: H, redirect: 'follow' });
    const t = await r.text();
    console.log('---', u, r.status, 'len=' + t.length, 'final=' + r.url);
    if (r.status !== 200) { console.log(t.slice(0, 200)); continue; }
    const keys = ['betconstruct','swarm','digitain','altenar','sbtech','everymatrix','betsy','tglab','sportsbook','__NUXT__','__NEXT_DATA__','graphql','site_id','siteId','partnerId','apiUrl','wss://','betgames'];
    console.log('indices:', keys.filter((k) => new RegExp(k, 'i').test(t)).join(', '));
    const src = [...t.matchAll(/(?:src|href)="([^"]+\.js[^"]*)"/g)].map((m) => m[1]).slice(0, 20);
    console.log('bundles:', JSON.stringify(src));
    for (const s of src.slice(0, 6)) {
      const abs = s.startsWith('http') ? s : new URL(s, r.url).href;
      try {
        const b = await (await fetch(abs, { headers: H })).text();
        const hits = keys.filter((k) => new RegExp(k, 'i').test(b));
        const api = [...new Set([...b.matchAll(/https?:\/\/[a-z0-9.\-]+\/[a-z0-9\/_\-.]*(api|swarm|graphql)[a-z0-9\/_\-.]*/gi)].map((m) => m[0]))].slice(0, 12);
        const ws = [...new Set([...b.matchAll(/wss?:\/\/[a-z0-9.\-\/]+/gi)].map((m) => m[0]))].slice(0, 6);
        console.log('  bundle', abs.slice(-60), 'len=' + b.length, '| indices:', hits.join(','), '| api:', JSON.stringify(api), '| ws:', JSON.stringify(ws));
      } catch (e) { console.log('  bundle KO', abs.slice(-40), e.message); }
    }
  } catch (e) { console.log('---', u, 'KO', e.message); }
}
