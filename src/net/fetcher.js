// Couche unique de fetch traversant Cloudflare/WAF pour les bookmakers protégés.
// Isolée derrière une interface commune ; les parsers de bookmakers ne connaissent
// que `proxyFetchJson(url, opts)` — changer le fournisseur ne touche pas au reste.
import { config } from '../config.js';
import { createSemaphore, createTtlCache } from './limiter.js';

const semaphore = createSemaphore(config.proxy.maxConcurrency);
const cache = createTtlCache(config.proxy.cacheTtlMs);

async function directFetch(url, { headers = {}, method = 'GET', body, timeoutMs = 20_000, extraHeaders = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method, body, signal: ctrl.signal,
      headers: { ...headers, ...extraHeaders },
    });
    return res;
  } finally { clearTimeout(t); }
}

async function jinaProxy(url, opts) {
  const key = config.proxy.jinaKey;
  const extraHeaders = {
    Authorization: key ? `Bearer ${key}` : '',
    'X-Return-Format': 'text',
    'x-respond-with': 'text',
    accept: '*/*',
    ...(opts.extraHeaders || {}),
  };
  if (opts.setHeaders) extraHeaders['X-Set-Headers'] = JSON.stringify(opts.setHeaders);
  return directFetch(`https://r.jina.ai/${url}`, { ...opts, extraHeaders });
}

async function residentialProxy(url, opts) {
  const proxyUrl = config.proxy.residentialUrl;
  if (!proxyUrl) throw new Error('RESIDENTIAL_PROXY_URL non défini');
  // fetch natif Node 18 ne prend pas de proxy directement : on utilise undici.
  const undici = await import('undici');
  const dispatcher = new undici.ProxyAgent(proxyUrl);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 20_000);
  try {
    return await undici.fetch(url, {
      method: opts.method || 'GET', body: opts.body, signal: ctrl.signal,
      headers: { ...(opts.headers || {}), ...(opts.extraHeaders || {}) },
      dispatcher,
    });
  } finally { clearTimeout(t); }
}

async function cfworkerProxy(url, opts) {
  const workerUrl = config.proxy.cfworkerUrl;
  if (!workerUrl) throw new Error('CF_WORKER_PROXY_URL non défini');
  const headers = {};
  for (const [k, v] of Object.entries(opts.setHeaders || {})) {
    headers[`x-forward-${k}`] = v;
  }
  return directFetch(`${workerUrl}/?url=${encodeURIComponent(url)}`, { ...opts, headers, extraHeaders: {} });
}

export async function proxyFetchText(url, opts = {}) {
  const cacheKey = `${opts.method || 'GET'}:${url}:${opts.body || ''}`;
  if (!opts.noCache) {
    const hit = cache.get(cacheKey);
    if (hit !== undefined) return hit;
  }
  return semaphore(async () => {
    let res;
    if (config.proxy.mode === 'cfworker') res = await cfworkerProxy(url, opts);
    else if (config.proxy.mode === 'residential') res = await residentialProxy(url, opts);
    else if (config.proxy.mode === 'headless') {
      const { headlessFetch } = await import('./headless.js');
      res = await headlessFetch(url, opts);
    } else res = await jinaProxy(url, opts);
    if (!res.ok) return null;
    const text = await res.text();
    if (!opts.noCache && text) cache.set(cacheKey, text);
    return text;
  });
}

export async function proxyFetchJson(url, opts = {}) {
  const text = await proxyFetchText(url, opts);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// Fetch DIRECT (sans proxy) — pour les APIs publiques (Sportcash, Apollo, 1win, congobet).
// Toujours protégé par le sémaphore global pour lisser la charge.
export async function fetchJson(url, opts = {}) {
  return semaphore(async () => {
    try {
      const res = await directFetch(url, opts);
      if (!res.ok) return null;
      const t = await res.text();
      if (!t) return null;
      try { return JSON.parse(t); } catch { return null; }
    } catch { return null; }
  });
}
