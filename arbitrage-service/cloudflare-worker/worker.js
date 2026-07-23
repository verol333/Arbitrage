// Cloudflare Worker — Proxy générique gratuit (100 000 req/jour)
// Déployez ce Worker sur votre compte Cloudflare (gratuit).
// URL d'usage : https://votre-worker.votre-compte.workers.dev/?url=https://site-cible.com/api
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');

    if (!target) {
      return new Response(JSON.stringify({ error: 'param url manquant' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const targetUrl = new URL(target);

      const headers = new Headers();
      headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      headers.set('Accept', request.headers.get('Accept') || '*/*');
      headers.set('Accept-Language', 'fr-FR,fr;q=0.9,en;q=0.8');

      for (const [key, value] of request.headers) {
        if (key.startsWith('x-forward-')) {
          headers.set(key.replace('x-forward-', ''), value);
        }
      }

      const resp = await fetch(targetUrl.toString(), {
        method: request.method,
        headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      });

      const responseHeaders = new Headers(resp.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.delete('set-cookie');

      return new Response(resp.body, {
        status: resp.status,
        headers: responseHeaders,
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
