// Sonde 1xBet : liste 5 vrais matchs foot, puis dump TOUS les groupes de marchés
// (GE) et sous-jeux (SG) avec leur ID/nom afin de construire le dictionnaire.
// Usage : node scripts/probe-xbet.js > /tmp/probe-xbet.out.json

const FEED = 'https://1xbet.cg';
const COUNTRY = 93;
const PARTNER = 192;
const CF_WORKERS = [
  'https://hidden-pine-7436.veolalex3.workers.dev',
  'https://billowing-sea-2d8e.alvecapital60.workers.dev',
];
const HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'fr-FR,fr;q=0.9',
  'content-type': 'application/json',
  origin: FEED,
  referer: `${FEED}/en/line`,
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'x-requested-with': 'XMLHttpRequest',
};

async function fetchJson(url, headers = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) return null;
    const t2 = await res.text();
    return t2 ? JSON.parse(t2) : null;
  } catch { return null; }
  finally { clearTimeout(t); }
}

async function viaWorker(url) {
  for (const w of CF_WORKERS) {
    const j = await fetchJson(`${w}/?url=${encodeURIComponent(url)}`, HEADERS);
    if (j) return j;
  }
  return null;
}

function isFakeTeam(n) {
  return /à domicile|à l'extérieur|home team|away team|player|joueur|^home$|^away$/i.test((n || '').trim());
}
function isVirtual(h, a, l) {
  const s = `${h} ${a} ${l}`.toLowerCase();
  return /\bsrl\b|simulated|\besoccer\b|e-?soccer|\bcyber\b|\bvirtual\b|\besports?\b|\bfifa\b|\bpes\b|\be-?/i.test(s);
}

async function listMatches() {
  // 1) Champs foot (sport=1).
  const champs = await viaWorker(`${FEED}/service-api/LineFeed/GetChampsZip?sport=1&lng=en&country=${COUNTRY}&partner=${PARTNER}`);
  const champIds = [...new Set((champs?.Value || [])
    .filter((c) => !/spéci|special|player|joueur|team vs|vs player|winner|outright/i.test(c.LE || c.L || ''))
    .map((c) => c.LI || c.CI).filter(Boolean))]
    .slice(0, 6); // 6 champs suffit pour trouver 5 matchs vrais.
  const all = [];
  for (const ci of champIds) {
    const r = await viaWorker(`${FEED}/service-api/LineFeed/Get1x2_VZip?champs=${ci}&count=50&lng=en&mode=4&country=${COUNTRY}&partner=${PARTNER}&getEmpty=true`);
    for (const m of (r?.Value || [])) {
      if (m.I && m.O1 && m.O2 && !isFakeTeam(m.O1) && !isFakeTeam(m.O2) && !isVirtual(m.O1, m.O2, m.LE || m.L || '')) {
        all.push({ id: m.I, home: m.O1, away: m.O2, league: m.LE || m.L || '', start: m.S * 1000 });
      }
    }
    if (all.length >= 20) break;
  }
  // Filtre : matchs à venir dans les prochaines 48h (pas des trucs bizarres à 3 mois).
  const now = Date.now(), horizon = now + 48 * 3600 * 1000;
  const filtered = all.filter((m) => m.start > now + 30 * 60 * 1000 && m.start < horizon);
  return filtered.slice(0, 5);
}

async function probeMatch(m) {
  const url = `${FEED}/service-api/LineFeed/GetGameZip?id=${m.id}&lng=fr&isSubGames=true&GroupEvents=true&countevents=2000&grMode=4&country=${COUNTRY}&marketType=1&isNewBuilder=true`;
  const gd = await viaWorker(url);
  if (!gd?.Value) return null;
  const v = gd.Value;
  const groups = (v.GE || []).map((g) => ({
    G: g.G,
    GN: g.GN || g.N || '',
    events: (g.E || []).flatMap((sub) => (Array.isArray(sub) ? sub : [sub]))
      .map((it) => ({ T: it.T, N: it.N || it.NA || '', P: it.P, C: it.C }))
      .filter((it) => it.T != null && it.C != null),
  }));
  const subs = (v.SG || []).map((sg) => ({
    I: sg.I, PN: sg.PN || '', TG: sg.TG || '', P: sg.P, MG: sg.MG || null,
  }));
  return { match: m, groups, subGamesCount: subs.length, subGames: subs.slice(0, 30) };
}

(async () => {
  const matches = await listMatches();
  console.error(`[probe] ${matches.length} matchs foot trouves`);
  const dumps = [];
  for (const m of matches) {
    console.error(`  → ${m.home} vs ${m.away} (${m.league}) — ${new Date(m.start).toISOString()}`);
    const d = await probeMatch(m);
    if (d) dumps.push(d);
  }
  // Aggregate : union des groupes G rencontres avec leur GN + toutes les combinaisons T observees.
  const gMap = new Map();
  for (const d of dumps) {
    for (const g of d.groups) {
      if (!gMap.has(g.G)) gMap.set(g.G, { G: g.G, GN: new Set(), T: new Map() });
      const e = gMap.get(g.G);
      if (g.GN) e.GN.add(g.GN);
      for (const it of g.events) {
        const key = `T${it.T}`;
        if (!e.T.has(key)) e.T.set(key, { T: it.T, samples: new Set() });
        const s = e.T.get(key);
        if (it.N && s.samples.size < 5) s.samples.add(it.N);
        if (it.P != null && s.samples.size < 5) s.samples.add(`P=${it.P}`);
      }
    }
  }
  const groupsAgg = [...gMap.values()].map((e) => ({
    G: e.G,
    names: [...e.GN],
    T: [...e.T.values()].map((t) => ({ T: t.T, samples: [...t.samples] })).sort((a, b) => a.T - b.T),
  })).sort((a, b) => a.G - b.G);

  // Sub-games : dedupe par PN|TG|P.
  const sgMap = new Map();
  for (const d of dumps) for (const sg of d.subGames) {
    const key = `${sg.PN}|${sg.TG}|${sg.P || ''}`;
    if (!sgMap.has(key)) sgMap.set(key, { PN: sg.PN, TG: sg.TG, P: sg.P, samples: [] });
    if (sgMap.get(key).samples.length < 3) sgMap.get(key).samples.push(sg.I);
  }
  const subGamesAgg = [...sgMap.values()];

  const out = {
    matches: matches.map((m) => ({ id: m.id, home: m.home, away: m.away, league: m.league, start_iso: new Date(m.start).toISOString() })),
    groups: groupsAgg,
    subGames: subGamesAgg,
  };
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
