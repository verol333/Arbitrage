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

// Marque comme "stale" les anciennes opps du sport+mode courants avant d'inserer
// les nouvelles. Chaque sport est marque independamment (foot vs tennis vs autres).
async function markStaleForSport({ live, sport }) {
  if (!base44Configured() || !sport) return;
  await base44Fetch(`/entities/${ENTITY}/update-many`, {
    method: 'POST',
    body: JSON.stringify({
      filter: { status: 'live', sport, is_live: !!live },
      update: { status: 'stale' },
    }),
  }).catch(() => { /* silencieux — si l'API refuse, on ne bloque pas le scan */ });
}

// Purge des sports NON-SCANNES : sport qui n'est PAS dans SCAN_SPORTS mais
// dont des opps trainent en 'live' Base44. Evite l'accumulation ad vitam.
function purgeUnscannedSports() {
  if (!base44Configured()) return Promise.resolve();
  const scanned = new Set((process.env.SCAN_SPORTS || 'football').split(',').map(s => s.trim().toLowerCase()));
  const jobs = [];
  for (const sport of ['football', 'tennis', 'basketball', 'hockey', 'volleyball']) {
    if (scanned.has(sport)) continue;
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

export async function persistOpportunities(opps, { live = false, sport = 'football' } = {}) {
  if (!base44Configured()) return;
  // Purge sports non-scannes + markStale du sport courant en parallele.
  await Promise.allSettled([purgeUnscannedSports(), markStaleForSport({ live, sport })]);
  await bulkCreate(opps);
}
