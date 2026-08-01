// Persistance des opportunités dans l'entité ArbitrageOpportunity de Base44.
// Si BASE44_API_URL / BASE44_SERVICE_KEY sont vides → no-op silencieux
// (les opportunités restent en mémoire, disponibles via /opportunities).
import { config } from '../config.js';

const ENTITY = 'ArbitrageOpportunity';

function base44Configured() {
  return Boolean(config.base44.apiUrl && config.base44.serviceKey);
}

async function base44Fetch(path, init = {}) {
  const url = `${config.base44.apiUrl.replace(/\/$/, '')}${path}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.base44.serviceKey}`,
        ...(init.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`base44 ${res.status} ${res.statusText}`);
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  } finally { clearTimeout(t); }
}

// Marque comme "stale" les anciennes opps du sport courant avant d'insérer
// les nouvelles.
async function markStaleFoot({ live }) {
  if (!base44Configured()) return;
  await base44Fetch(`/entities/${ENTITY}/update-many`, {
    method: 'POST',
    body: JSON.stringify({
      filter: { status: 'live', sport: 'football', is_live: !!live },
      update: { status: 'stale' },
    }),
  }).catch(() => { /* silencieux — si l'API refuse, on ne bloque pas le scan */ });
}

// Nettoie systématiquement les vieilles opps NON-FOOT (tennis, basket, hockey,
// volley) qui traînent en 'live' dans Base44 depuis l'ère multi-sport. Comme
// on ne scanne plus ces sports, markStaleFoot ne les nettoyait pas et elles
// restaient visibles indéfiniment côté client. Les 8 appels sont parallélisés
// et ne bloquent pas — on n'attend pas leur résolution avant de continuer.
function purgeNonFootStale() {
  if (!base44Configured()) return Promise.resolve();
  const jobs = [];
  for (const sport of ['tennis', 'basketball', 'hockey', 'volleyball']) {
    for (const isLive of [true, false]) {
      jobs.push(base44Fetch(`/entities/${ENTITY}/update-many`, {
        method: 'POST',
        body: JSON.stringify({
          filter: { status: 'live', sport, is_live: isLive },
          update: { status: 'stale' },
        }),
      }).catch(() => null));
    }
  }
  return Promise.allSettled(jobs);
}

async function bulkCreate(opps) {
  if (!base44Configured() || !opps.length) return;
  for (let i = 0; i < opps.length; i += 50) {
    const chunk = opps.slice(i, i + 50);
    await base44Fetch(`/entities/${ENTITY}/bulk-create`, {
      method: 'POST',
      body: JSON.stringify({ items: chunk }),
    }).catch((e) => console.warn(`base44 bulkCreate: ${e.message}`));
  }
}

export async function persistOpportunities(opps, { live = false } = {}) {
  if (!base44Configured()) return;
  // Purge non-foot et markStale foot en parallèle — pas de dépendance mutuelle.
  await Promise.allSettled([purgeNonFootStale(), markStaleFoot({ live })]);
  await bulkCreate(opps);
}
