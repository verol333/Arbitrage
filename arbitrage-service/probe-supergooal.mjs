// Sonde Supergooal (Meridian) depuis les IP GitHub.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Accept': 'text/html,application/json', 'Accept-Language': 'fr-FR,fr;q=0.9' };
const urls = [
  'https://supergooal.cg/fr/pari',
  'https://supergooal.cg/betshop/api/v1/standard/sport/58/leagues?page=0&time=ALL',
  'https://supergooal.cg/betshop/api/v2/standard/sport/58/leagues?page=0&time=ALL',
  'https://supergooal.cg/betshop/api/v1/standard/sport/58/region/all/league/all/events?page=0',
  'https://online.meridianbet.com/betshop/api/v1/standard/sport/58/leagues?page=0&time=ALL',
];
for (const u of urls) {
  try {
    const r = await fetch(u, { headers: H, redirect: 'follow' });
    const t = await r.text();
    console.log('---', u, '->', r.status, 'len', t.length);
    console.log(t.slice(0, 700).replace(/\s+/g, ' '));
    if (/pari/.test(u) && r.ok) {
      const js = [...new Set(t.match(/(?:src|href)="[^"]+\.js[^"]*"/g) || [])];
      console.log('JS:', JSON.stringify(js.slice(0, 30)));
      const api = [...new Set(t.match(/https?:\/\/[a-z0-9.\-]+[^"' ]*(api|graphql)[^"' ]{0,60}/gi) || [])];
      console.log('API:', JSON.stringify(api.slice(0, 30)));
    }
  } catch (e) { console.log('---', u, 'ERR', e.message); }
}
