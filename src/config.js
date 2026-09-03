// Lecture centralisée des variables d'environnement (pas de secrets en dur).
const num = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

export const config = {
  port: num(process.env.PORT, 10000),
  apiSecretKey: process.env.API_SECRET_KEY || '',

  proxy: {
    mode: (process.env.PROXY_MODE || 'jina').toLowerCase(),
    jinaKey: process.env.JINA_API_KEY || '',
    jinaKey2: process.env.JINA_API_KEY_2 || '', // cle de secours (bascule auto sur 401/402)
    residentialUrl: process.env.RESIDENTIAL_PROXY_URL || '',
    cfworkerUrl: process.env.CF_WORKER_PROXY_URL || '',
    cacheTtlMs: num(process.env.PROXY_CACHE_TTL_MS, 75_000),
    maxConcurrency: num(process.env.PROXY_MAX_CONCURRENCY, 12),
  },

  base44: {
    apiUrl: process.env.BASE44_API_URL || '',
    serviceKey: process.env.BASE44_SERVICE_KEY || '',
  },

  scan: {
    minProfitPrematch: num(process.env.MIN_PROFIT_PREMATCH, 0.5),
    minProfitLive: num(process.env.MIN_PROFIT_LIVE, 0.5),
    // Aucun cap arbitraire. Les fausses opps doivent être éliminées par la
    // correction du code (parsers exacts, matching correct, orientation
    // vérifiée), pas masquées par un plafond.
    maxProfitSanity: num(process.env.MAX_PROFIT_SANITY, 999),
    maxMatches: num(process.env.MAX_MATCHES, 400),
    horizonHours: num(process.env.HORIZON_HOURS, 72),
  },

  cron: {
    prematchCron: process.env.CRON_PREMATCH || '*/5 * * * *',
    liveIntervalMs: num(process.env.LIVE_INTERVAL_MS, 15_000),
  },
};
