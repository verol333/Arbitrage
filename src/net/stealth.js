import { gotScraping } from 'got-scraping';

const CHROME_OPTS = {
  browsers: [{ name: 'chrome', minVersion: 114, maxVersion: 126 }],
  devices: ['desktop'],
  locales: ['fr-FR', 'en-US'],
  operatingSystems: ['linux'],
};

let sessionCounter = 0;

export async function stealthGetJson(url, { headers = {}, timeoutMs = 20_000 } = {}) {
  const token = `s${++sessionCounter}`;
  const res = await gotScraping({
    url,
    headers,
    headerGeneratorOptions: CHROME_OPTS,
    useHttp2: true,
    sessionToken: token,
    timeout: { request: timeoutMs },
    retry: { limit: 1 },
    throwHttpErrors: false,
  });
  if (res.statusCode < 200 || res.statusCode >= 300 || !res.body) return null;
  try { return JSON.parse(res.body); } catch { return null; }
}
