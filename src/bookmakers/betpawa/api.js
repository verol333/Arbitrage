// BetPawa Congo — accès via CF Worker dédié (betpawa-scraper).
// Le site cg.betpawa.com est protégé (bloque les IPs datacenter). Le Worker
// Cloudflare appelle l'API BetPawa depuis les IPs Cloudflare (non bloquées),
// parse le protobuf, et retourne du JSON propre.
import { createSemaphore, createTtlCache } from '../../net/limiter.js';

const WORKER_URL = 'https://betpawa-scraper.veolalex3.workers.dev';
const semaphore = createSemaphore(4);
const cacheLong = createTtlCache(60_000);
const cacheShort = createTtlCache(15_000);

async function httpGet(url, timeoutMs = 20_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: ctrl.signal,
    });
    const body = await res.text();
    return { status: res.status, body, dur: Date.now() - t0 };
  } catch (e) {
    return { status: 0, body: '', dur: Date.now() - t0, err: e.message };
  } finally { clearTimeout(t); }
}

export async function bpGet(params = {}, { long = false, noCache = false } = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${WORKER_URL}/?${qs}`;
  const cache = long ? cacheLong : cacheShort;
  if (!noCache) {
    const hit = cache.get(url);
    if (hit !== undefined) return hit;
  }
  return semaphore(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await httpGet(url);
      if (r.status === 200) {
        try {
          const j = JSON.parse(r.body);
          console.log(`[betpawa] GET ?${qs} status=200 size=${r.body.length}b dur=${r.dur}ms matches=${j.totalMatches ?? '?'}`);
          if (!noCache) cache.set(url, j);
          return j;
        } catch {
          console.log(`[betpawa] GET ?${qs} status=200 parse-fail dur=${r.dur}ms`);
        }
      } else {
        console.log(`[betpawa] GET ?${qs} status=${r.status || 0} dur=${r.dur}ms err=${r.err || r.body?.slice(0, 80)}`);
      }
      if (attempt < 1) await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  });
}

export { isVirtualText as isVirtual } from '../../core/text.js';
