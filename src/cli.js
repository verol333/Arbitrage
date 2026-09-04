import { runScan, log } from './scanners/collect.js';

// Filet de securite CRITIQUE : depuis Node 15, une unhandledRejection tue
// le process (exit code 1 ou 13). Ca a killed le run #119 le 2026-08-08 15:24
// (cron 14:00) apres seulement 59min, laissant un trou de 1h46 sans POST
// live jusqu'au cron 18:00. Handler global : on log, on continue.
process.on('unhandledRejection', (reason) => {
  console.error(`[unhandledRejection] ${reason?.stack || reason?.message || String(reason)}`);
});
process.on('uncaughtException', (err) => {
  console.error(`[uncaughtException] ${err?.stack || err?.message || String(err)}`);
});

async function sendWebhook(payload) {
  const url = process.env.WEBHOOK_URL;
  const secret = process.env.WEBHOOK_SECRET;
  if (!url) return;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const bodyStr = JSON.stringify(payload);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': secret || '' },
      body: bodyStr,
      signal: ctrl.signal,
    });
    let respText = '';
    try { respText = (await res.text()).slice(0, 500); } catch {}
    // Détecte les rejets soft du backend (HTTP 200 mais body ok:false / blocked:true).
    // Sinon un webhook en "reconstruction" qui rejette tout est invisible dans les logs.
    // Log explicite de received/inserted (demande dev pour trancher POST-vide vs stopped-scanner).
    let parsedOk = null; let received = null; let inserted = null;
    try {
      const j = JSON.parse(respText);
      if (j && typeof j === 'object') {
        if (j.ok === false) parsedOk = false;
        else if (j.ok === true) parsedOk = true;
        if (typeof j.received === 'number') received = j.received;
        if (typeof j.inserted === 'number') inserted = j.inserted;
      }
    } catch { /* ignore */ }
    const alertPrefix = parsedOk === false ? '⚠️ REJET BACKEND — ' : '';
    const ackFields = (received != null || inserted != null) ? ` ack=received:${received}/inserted:${inserted}` : '';
    console.log(`[webhook] ${alertPrefix}sport=${payload.sport} status=${res.status} count=${payload.count}${ackFields} bodySize=${bodyStr.length}B resp="${respText}"`);
  } catch (e) {
    console.warn(`[webhook] sport=${payload.sport} erreur: ${e.message}`);
  } finally { clearTimeout(t); }
}

function logSample(result, { live = false, sport = 'football' } = {}) {
  if (!result.opportunities?.length) return;
  if (live) {
    const first = result.opportunities[0];
    log(`  → live sample: score=${first.live_score ?? 'null'} min=${first.live_minute ?? 'null'} period=${first.live_period ?? 'null'} src=${first.live_score_source ?? 'null'} match=${first.match_label}`);
  }
  const first = result.opportunities[0];
  log(`  → ${sport} sample opp fields: sport=${first.sport} market_family="${first.market_family}" match_label="${first.match_label}" league="${first.league || ''}" status=${first.status} is_live=${first.is_live}`);
}

// Envoi FUSIONNE (foot + tennis dans un seul POST) pour eviter que le 2e
// webhook ecrase les opps du 1er cote backend (bug "un seul sport
// affiche a la fois"). Marker sport="multi" pour que le handler backend
// itere sur opps par .sport individuellement (voir arbitrageWebhook).
async function notifyWebhookMerged(resultsBySport, { live = false } = {}) {
  const merged = [];
  const countsBySport = {};
  for (const [sport, result] of Object.entries(resultsBySport)) {
    const opps = result?.opportunities || [];
    countsBySport[sport] = opps.length;
    if (opps.length) merged.push(...opps);
  }
  if (!merged.length) return;
  // AUDIT distribution : verifie que chaque opp a bien sa cle .sport individuelle.
  // Diagnostic backend : si l'app n'affiche pas basket/tennis, verifier que .sport
  // n'est pas ecrase par root sport='multi' cote insertion Mongo.
  const distribInMerged = {};
  const missingSport = [];
  for (const o of merged) {
    const s = o.sport || 'undefined';
    distribInMerged[s] = (distribInMerged[s] || 0) + 1;
    if (!o.sport) missingSport.push(`${o.leg_a_book}-${o.leg_b_book}:${o.market_family}`);
  }
  const firstBySport = {};
  for (const o of merged) {
    if (o.sport && !firstBySport[o.sport]) {
      firstBySport[o.sport] = `${o.market_family} | ${o.leg_a_book}@${o.leg_a_odd} vs ${o.leg_b_book}@${o.leg_b_odd}`;
    }
  }
  console.log(`[webhook AUDIT] payload count=${merged.length} distrib_in_opportunities=${JSON.stringify(distribInMerged)} counts_by_sport=${JSON.stringify(countsBySport)}`);
  for (const [s, ex] of Object.entries(firstBySport)) console.log(`[webhook AUDIT] first opp sport="${s}": ${ex}`);
  if (missingSport.length) console.log(`[webhook AUDIT] ⚠️ ${missingSport.length} opps sans champ .sport : ${missingSport.slice(0, 3).join(' | ')}`);
  await sendWebhook({
    type: 'arbitrage_alert',
    scan_type: live ? 'live' : 'prematch',
    sport: 'multi',
    sports: Object.keys(countsBySport),
    counts_by_sport: countsBySport,
    timestamp: new Date().toISOString(),
    count: merged.length,
    opportunities: merged,
  });
}

const mode = process.argv[2] || 'prematch';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Watchdog : un cycle bloque (socket keep-alive mort, promesse jamais resolue)
// ne doit JAMAIS figer la boucle. On log et on passe au cycle suivant.
// Budget PAR SPORT (et non plus pour le lot entier) : un sport lent ne peut
// plus annuler le travail deja fait par les autres. 285s laisse au foot la
// quasi-totalite du creneau de 5 min sans jamais chevaucher le cycle suivant.
const CYCLE_TIMEOUT_PREMATCH_MS = 285_000;
// Le football a son propre budget : son catalogue (13 books, ~10 000 matchs
// listes, appariement de 1500 rencontres) consomme a lui seul plus de 250s
// AVANT la lecture des cotes. A 285s le cycle etait annule par le watchdog et
// tout le travail perdu (aucune opportunite publiee, Betclic inclus). Chaque
// sport tourne sur son propre runner : allonger le foot ne penalise personne,
// il tourne simplement toutes les ~9 min au lieu de 5.
const CYCLE_TIMEOUT_PREMATCH_FOOTBALL_MS = 540_000;
const CYCLE_TIMEOUT_LIVE_MS = 120_000;
function withTimeout(promise, ms, label) {
  let t;
  const guard = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`watchdog: ${label} > ${ms / 1000}s`)), ms); });
  return Promise.race([promise, guard]).finally(() => clearTimeout(t));
}

// Multi-sport : SCAN_SPORTS="football,tennis" scanne les deux en parallele.
const SPORTS = (process.env.SCAN_SPORTS || 'football').split(',').map(s => s.trim()).filter(Boolean);

async function doScan({ live, sport }) {
  const result = await runScan({
    live, sport,
    minProfit: Number(live ? process.env.MIN_PROFIT_LIVE || 0.5 : process.env.MIN_PROFIT_PREMATCH || 0.5),
    horizonHours: Number(process.env.HORIZON_HOURS || 72),
  });
  logSample(result, { live, sport });
  return result;
}

async function doAllSports({ live }) {
  // Tous les sports en PARALLELE. ENVOI STREAMING : chaque sport est POSTe des
  // que SON scan finit, au lieu d'attendre que le sport le plus lent termine.
  // Avant : un surebet foot detecte a t+8s n'etait envoye qu'a t+50s (fin du
  // cycle complet) — en live la cote etait deja morte. Le webhook range chaque
  // opp par son champ .sport et ne supprime rien : un POST par sport est donc
  // strictement equivalent, mais immediat.
  const totals = {};
  const budget = (sport) => live ? CYCLE_TIMEOUT_LIVE_MS
    : sport === 'football' ? CYCLE_TIMEOUT_PREMATCH_FOOTBALL_MS : CYCLE_TIMEOUT_PREMATCH_MS;
  await Promise.all(SPORTS.map(async (sport) => {
    try {
      const result = await withTimeout(doScan({ live, sport }), budget(sport), sport + ' scan');
      totals[sport] = result.opportunities?.length ?? 0;
      await notifyWebhookMerged({ [sport]: result }, { live });
    } catch (e) {
      totals[sport] = 'ERR';
      log(`  ⚠️ ${sport} scan erreur: ${e?.message || e}`);
    }
  }));
  return totals;
}

async function main() {
if (mode === 'prematch') {
  const durMin = parseInt(process.env.PREMATCH_DURATION_MINUTES || '0', 10);
  if (durMin > 0) {
    const interval = parseInt(process.env.PREMATCH_INTERVAL_MS || '300000', 10);
    const end = Date.now() + durMin * 60 * 1000;
    let cycles = 0;
    log(`▶ Scan PRÉMATCH LOOP sports=[${SPORTS.join(',')}] — boucle ${durMin} min, intervalle ${interval / 1000}s`);
    while (Date.now() < end) {
      try {
        const totals = await doAllSports({ live: false });
        cycles++;
        const summary = Object.entries(totals).map(([s, n]) => `${s}:${n}`).join(' | ');
        log(`  cycle ${cycles}: ${summary}`);
      } catch (e) {
        log(`  cycle ${cycles + 1}: erreur — ${e.message}`);
        cycles++;
      }
      if (end - Date.now() > interval) await sleep(interval);
      else break;
    }
    log(`✅ Prématch loop terminé — ${cycles} cycles (${durMin} min)`);
  } else {
    log(`▶ Scan PRÉMATCH sports=[${SPORTS.join(',')}] (parallele)`);
    const totals = await doAllSports({ live: false });
    const summary = Object.entries(totals).map(([s, n]) => `${s}:${n}`).join(' | ');
    log(`✅ Prématch terminé — ${summary}`);
  }
} else if (mode === 'live') {
  const duration = parseInt(process.env.SCAN_DURATION_MINUTES || '30', 10);
  const interval = parseInt(process.env.LIVE_INTERVAL_MS || '15000', 10);
  const end = Date.now() + duration * 60 * 1000;
  let cycles = 0;
  log(`▶ Scan LIVE sports=[${SPORTS.join(',')}] — boucle ${duration} min, intervalle ${interval / 1000}s`);
  while (Date.now() < end) {
    try {
      const totals = await doAllSports({ live: true });
      cycles++;
      const summary = Object.entries(totals).map(([s, n]) => `${s}:${n}`).join(' | ');
      log(`  cycle ${cycles}: ${summary}`);
    } catch (e) {
      log(`  cycle ${cycles + 1}: erreur — ${e.message}`);
      cycles++;
    }
    if (end - Date.now() > interval) await sleep(interval);
    else break;
  }
  log(`✅ Live terminé — ${cycles} cycles (${duration} min)`);
} else {
  console.error(`Mode inconnu : ${mode}. Utilisez "prematch" ou "live".`);
  process.exit(1);
}
}

// Le top-level await faisait sortir Node en code 13 ("Unsettled Top-Level
// Await") des qu'une promesse restait pendante et que la boucle d'evenements
// se vidait : le scan mourait en pleine course. main() + handle keep-alive.
const keepAlive = setInterval(() => {}, 60_000);
main()
  .catch((e) => { console.error(`[fatal] ${e?.stack || e?.message || String(e)}`); })
  .finally(() => { clearInterval(keepAlive); process.exit(0); });
