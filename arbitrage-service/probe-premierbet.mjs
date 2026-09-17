// Sonde PremierBet : depuis un runner GitHub (IP autorisee par Cloudflare).
// But : trouver les points d'entree de CONNEXION et de MISE du sportsbook.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9' };

async function txt(url, extra = {}) {
  try {
    const r = await fetch(url, { headers: { ...H, ...extra }, signal: AbortSignal.timeout(25000) });
    const t = await r.text();
    return { status: r.status, len: t.length, t };
  } catch (e) { return { status: 0, len: 0, t: 'ERR ' + e.message }; }
}

(async () => {
  for (const pays of ['cg', 'cm']) {
    const home = await txt('https://www.premierbet.com/' + pays, { Accept: 'text/html' });
    console.log('[' + pays + '] page accueil status=' + home.status + ' taille=' + home.len);
    if (home.status !== 200) continue;
    const scripts = [...new Set((home.t.match(/src="([^"]+\.js[^"]*)"/g) || []).map(s => s.slice(5, -1)))];
    console.log('[' + pays + '] scripts=' + scripts.length);
    const hosts = new Set(); const routes = new Set();
    for (const s of scripts.slice(0, 25)) {
      const u = s.startsWith('http') ? s : 'https://www.premierbet.com' + (s.startsWith('/') ? s : '/' + s);
      const js = await txt(u);
      if (js.status !== 200) continue;
      for (const m of js.t.match(/https?:\/\/[a-z0-9.-]*premierbet[a-z0-9.-]*/gi) || []) hosts.add(m.toLowerCase());
      for (const m of js.t.match(/["'\`][\/a-zA-Z0-9_.-]*(login|auth|token|session|register|bet|betslip|balance|wallet|account|user)[\/a-zA-Z0-9_.-]*["'\`]/g) || []) {
        const c = m.slice(1, -1);
        if (c.includes('/') && c.length < 70) routes.add(c);
      }
    }
    console.log('[' + pays + '] HOSTS ' + JSON.stringify([...hosts]));
    console.log('[' + pays + '] ROUTES ' + JSON.stringify([...routes].slice(0, 120)));
  }
})();
