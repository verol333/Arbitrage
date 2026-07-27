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
    // Aucun cap : on remonte TOUTES les opps detectees, y compris 40%+ qui
    // sont soit reelles (mapping parfait) soit faussees (parseur bogue). Un
    // plafond arbitraire masquerait les vraies grosses arbs ET rendrait
    // invisible le mapping bogue qu'il faut corriger. Le bon traitement =
    // logger chaque opp + verifier les cotes reelles sur les 2 bookmakers.
    maxProfitSanity: num(process.env.MAX_PROFIT_SANITY, Number.POSITIVE_INFINITY),
    maxMatches: num(process.env.MAX_MATCHES, 400),
    horizonHours: num(process.env.HORIZON_HOURS, 72),
  },

  cron: {
    prematchCron: process.env.CRON_PREMATCH || '*/5 * * * *',
    liveIntervalMs: num(process.env.LIVE_INTERVAL_MS, 15_000),
  },
};
