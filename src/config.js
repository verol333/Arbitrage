// Lecture centralisée des variables d'environnement (pas de secrets en dur).
const num = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
// Secrets GitHub Actions colles depuis un fichier arrivent parfois avec un
// trailing newline — casse toute concatenation d'URL. Trim systematique.
const str = (v) => String(v || '').trim();

export const config = {
  port: num(process.env.PORT, 10000),
  apiSecretKey: process.env.API_SECRET_KEY || '',

  proxy: {
    mode: str(process.env.PROXY_MODE || 'jina').toLowerCase(),
    jinaKey: str(process.env.JINA_API_KEY),
    residentialUrl: str(process.env.RESIDENTIAL_PROXY_URL),
    cfworkerUrl: str(process.env.CF_WORKER_PROXY_URL),
    cacheTtlMs: num(process.env.PROXY_CACHE_TTL_MS, 75_000),
    maxConcurrency: num(process.env.PROXY_MAX_CONCURRENCY, 6),
  },

  base44: {
    apiUrl: process.env.BASE44_API_URL || '',
    serviceKey: process.env.BASE44_SERVICE_KEY || '',
  },

  scan: {
    minProfitPrematch: num(process.env.MIN_PROFIT_PREMATCH, 0.5),
    minProfitLive: num(process.env.MIN_PROFIT_LIVE, 0.5),
    // Cap de sanity : au-dela de 20%, quasi-toujours un parseur bugue ou
    // une cote gelee/perimee. Un vrai surebet 20%+ est inedit sur un match
    // pre-match d'un bookmaker africain. Rejeter proteges les alertes de
    // pollution (audit 27/07 a montre 40%+ = tous faux positifs YellowBet HT).
    maxProfitSanity: num(process.env.MAX_PROFIT_SANITY, 20),
    maxMatches: num(process.env.MAX_MATCHES, 400),
    horizonHours: num(process.env.HORIZON_HOURS, 72),
  },

  cron: {
    prematchCron: process.env.CRON_PREMATCH || '*/5 * * * *',
    liveIntervalMs: num(process.env.LIVE_INTERVAL_MS, 15_000),
  },
};
