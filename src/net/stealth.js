import { gotScraping } from 'got-scraping';

const CHROME_OPTS = {
  browsers: [{ name: 'chrome', minVersion: 114, maxVersion: 126 }],
  devices: ['desktop'],
  locales: ['fr-FR', 'en-US'],
  operatingSystems: ['linux'],
};

export async function stealthGetJson(url, { headers = {}, timeoutMs = 20_000 } = {}) {
  try {
    const res = await gotScraping({
      url,
      headers,
      headerGeneratorOptions: CHROME_OPTS,
      timeout: { request: timeoutMs },
      retry: { limit: 2 },
      throwHttpErrors: false,
    });
    if (res.statusCode < 200 || res.statusCode >= 300 || !res.body) {
      console.log(`[stealth] ${url.slice(0, 60)}… → ${res.statusCode}`);
      return null;
    }
    return JSON.parse(res.body);
  } catch (e) {
    console.log(`[stealth] ${url.slice(0, 60)}… erreur: ${e.message}`);
    return null;
  }
}
