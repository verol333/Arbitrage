import { gotScraping } from 'got-scraping';

// Plusieurs profils fingerprint : rotation en cas de 403 Cloudflare.
// L'objectif est d'apparaître comme des visiteurs distincts (device, OS,
// version Chrome, langue) — Cloudflare marque une IP par profil récurrent.
const PROFILES = [
  {
    browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 126 }],
    devices: ['desktop'], locales: ['fr-FR'], operatingSystems: ['linux'],
  },
  {
    browsers: [{ name: 'chrome', minVersion: 118, maxVersion: 123 }],
    devices: ['desktop'], locales: ['en-US'], operatingSystems: ['windows'],
  },
  {
    browsers: [{ name: 'firefox', minVersion: 115, maxVersion: 121 }],
    devices: ['desktop'], locales: ['fr-FR'], operatingSystems: ['linux'],
  },
  {
    browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 126 }],
    devices: ['mobile'], locales: ['fr-FR'], operatingSystems: ['android'],
  },
];
let pCursor = 0;
const nextProfile = () => PROFILES[pCursor++ % PROFILES.length];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryOnce(url, { headers, timeoutMs, profile }) {
  try {
    const res = await gotScraping({
      url,
      headers,
      headerGeneratorOptions: profile,
      timeout: { request: timeoutMs },
      retry: { limit: 0 },
      throwHttpErrors: false,
    });
    return { status: res.statusCode, body: res.body };
  } catch (e) {
    return { status: 0, body: null, err: e.message };
  }
}

export async function stealthGetJson(url, { headers = {}, timeoutMs = 20_000 } = {}) {
  // Passe 1 : profil rotatif standard
  let attempt = await tryOnce(url, { headers, timeoutMs, profile: nextProfile() });
  // Retry sur 403/429 (Cloudflare block) avec un profil DIFFÉRENT + delay
  if (attempt.status === 403 || attempt.status === 429 || attempt.status === 503) {
    await sleep(800 + Math.floor(Math.random() * 800)); // 0.8-1.6s jitter
    attempt = await tryOnce(url, { headers, timeoutMs, profile: nextProfile() });
  }
  // Retry 2 sur 403/429 persistant
  if (attempt.status === 403 || attempt.status === 429 || attempt.status === 503) {
    await sleep(1500 + Math.floor(Math.random() * 1500));
    attempt = await tryOnce(url, { headers, timeoutMs, profile: nextProfile() });
  }
  // jina.ai fallback retiré (nécessite JINA_API_KEY qu'on n'a pas → 401).
  // La rotation fingerprint + retry 2x + jitter suffit à bypasser la plupart
  // des blocages Cloudflare pour les APIs publiques.
  if (attempt.status < 200 || attempt.status >= 300 || !attempt.body) {
    console.log(`[stealth] ${url.slice(0, 60)}… → ${attempt.status}${attempt.err ? ' ' + attempt.err : ''}`);
    return null;
  }
  try { return JSON.parse(attempt.body); } catch { return null; }
}
