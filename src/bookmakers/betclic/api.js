// Client Betclic : backend gRPC-web public offering.begmedia.com.
// Le site Betclic (.ci/.sn/.fr) bloque les IP de datacenter, mais ce backend
// repond en direct. Aucune authentification. Encodage/decodage protobuf fait
// main (aucune dependance).
//
// La regulation CI est la plus riche : 126 marches sur une grosse affiche
// contre 98 en FR (verifie le 03/09/2026 sur Real Madrid - Betis).
const BASE = 'https://offering.begmedia.com';
const SITES = { CI: 'https://www.betclic.ci', SN: 'https://www.betclic.sn', FR: 'https://www.betclic.fr' };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

export const BETCLIC_SPORTS = { football: 'football-s1' };
export const BETCLIC_PAGE = 40; // taille de page imposee par le serveur

// Categories utiles a l'arbitrage. Les onglets joueurs/buteurs (ca_ftb_gsc,
// ca_ftb_pssb) sont volontairement ignores : marches individuels, non arbitrables.
export const ARB_CATEGORIES = ['', 'ca_ftb_rslt', 'ca_ftb_goa', 'ca_ftb_cshcp', 'ca_ftb_prp'];

function varint(v) { const o = []; while (v > 0x7f) { o.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); } o.push(v & 0x7f); return o; }
function fVarint(n, v) { return [...varint(n << 3), ...varint(v)]; }
function fString(n, s) { const b = new TextEncoder().encode(s); return [...varint((n << 3) | 2), ...varint(b.length), ...b]; }
function grpcFrame(p) { const o = new Uint8Array(5 + p.length); new DataView(o.buffer).setUint32(1, p.length); o.set(p, 5); return o; }

function readVarint(d, pos) { let r = 0, sh = 0; while (pos < d.length) { const b = d[pos++]; r += (b & 0x7f) * Math.pow(2, sh); if (!(b & 0x80)) break; sh += 7; } return [r, pos]; }

function decode(d) {
  const fields = {}; let pos = 0;
  while (pos < d.length) {
    let tag; [tag, pos] = readVarint(d, pos);
    const num = tag >> 3, wire = tag & 7; let value;
    if (wire === 0) { [value, pos] = readVarint(d, pos); }
    else if (wire === 1) { if (pos + 8 > d.length) break; value = d.slice(pos, pos + 8); pos += 8; }
    else if (wire === 2) { let len; [len, pos] = readVarint(d, pos); if (pos + len > d.length) break; value = d.slice(pos, pos + len); pos += len; }
    else if (wire === 5) { if (pos + 4 > d.length) break; value = d.slice(pos, pos + 4); pos += 4; }
    else break;
    (fields[num] ||= []).push(value);
  }
  return fields;
}

function asText(v) {
  if (!(v instanceof Uint8Array)) return null;
  try { const s = new TextDecoder('utf-8', { fatal: true }).decode(v); return /[\u0000-\u0008\u000e-\u001f]/.test(s) ? null : s; } catch { return null; }
}
function asDouble(v) { if (!(v instanceof Uint8Array) || v.length !== 8) return null; const n = new DataView(v.buffer, v.byteOffset, 8).getFloat64(0, true); return Number.isFinite(n) ? n : null; }
function asInt(v) { return typeof v === 'number' ? v : null; }

function concat(parts, total) { const o = new Uint8Array(total); let off = 0; for (const p of parts) { o.set(p, off); off += p.length; } return o; }
function hasTrailer(buf) { let pos = 0; while (pos + 5 <= buf.length) { const flags = buf[pos]; const len = new DataView(buf.buffer, buf.byteOffset + pos + 1, 4).getUint32(0); pos += 5 + len; if (flags === 0x80) return true; } return false; }
function frames(raw) {
  const out = []; let pos = 0;
  while (pos + 5 <= raw.length) {
    const flags = raw[pos];
    const len = new DataView(raw.buffer, raw.byteOffset + pos + 1, 4).getUint32(0);
    pos += 5;
    if (flags !== 0x80) out.push(raw.slice(pos, pos + len));
    pos += len;
  }
  return out;
}

// Le flux est un abonnement temps reel : apres l'instantane initial plus rien
// n'arrive et aucune trame de fin n'est envoyee. On coupe donc des qu'il n'y a
// plus de donnees pendant `idle` ms.
async function call(service, method, payload, regulation, { maxBytes = 400000, timeout = 15000, idle = 1500 } = {}) {
  const site = SITES[regulation] || SITES.FR;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(BASE + '/' + service + '/' + method, {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'content-type': 'application/grpc-web+proto',
        accept: '*/*',
        'x-grpc-web': '1',
        'x-bg-ref-platform': 'DESKTOP',
        'x-bg-ref-brand': 'BETCLIC',
        'x-bg-regulation': regulation,
        'x-bg-ref-regulator-zone': regulation,
        origin: site,
        referer: site + '/',
        'user-agent': UA,
        'accept-language': 'fr-FR,fr;q=0.9',
      },
      body: grpcFrame(payload),
    });
    if (!res.ok) throw new Error('betclic_http_' + res.status);
    const reader = res.body.getReader();
    const parts = []; let total = 0;
    while (total < maxBytes) {
      const next = await Promise.race([
        reader.read(),
        new Promise((r) => setTimeout(() => r({ done: true }), total ? idle : timeout - 500)),
      ]);
      const { value, done } = next;
      if (done && !value) break;
      if (value) { parts.push(value); total += value.length; }
      if (total > 5) {
        const merged = concat(parts, total);
        if (hasTrailer(merged)) { try { await reader.cancel(); } catch {} return merged; }
      }
    }
    try { await reader.cancel(); } catch {}
    return concat(parts, total);
  } finally { clearTimeout(timer); }
}

function decodeMatch(data) {
  const f = decode(data);
  const m = { id: asInt(f[1]?.[0]), label: null, home: null, away: null, league: null, start: null };
  for (const v of f[2] || []) { const s = asText(v); if (s && s.includes(' - ')) { m.label = s; break; } if (s && !m.label) m.label = s; }
  for (const v of f[3] || []) { const s = asText(v); if (s && /\d{4}-\d{2}-\d{2}/.test(s)) { const t = Date.parse(s); if (!Number.isNaN(t)) { m.start = t; break; } } }
  const comp = f[8]?.[0];
  if (comp instanceof Uint8Array) m.league = asText(decode(comp)[2]?.[0]);
  const teams = [];
  for (const t of f[12] || []) { if (!(t instanceof Uint8Array)) continue; const n = asText(decode(t)[3]?.[0]); if (n) teams.push(n); }
  if (teams.length >= 2) { m.home = teams[0]; m.away = teams[1]; }
  else if (m.label && m.label.includes(' - ')) { const [h, a] = m.label.split(' - '); m.home = (h || '').trim() || null; m.away = (a || '').trim() || null; }
  return m;
}

function decodeSelection(data) {
  const f = decode(data);
  let name = null;
  for (const n of [10, 11, 2, 3]) { name = asText(f[n]?.[0]); if (name) break; }
  if (!name) return null;
  const odd = asDouble(f[12]?.[0]);
  if (odd === null || odd <= 1 || odd > 10000) return null;
  return { id: asInt(f[1]?.[0]), name, odd: Math.round(odd * 100) / 100 };
}

function extractSelections(md) {
  const f = decode(md); const out = [];
  for (const s of f[16] || []) { if (!(s instanceof Uint8Array)) continue; const sel = decodeSelection(s); if (sel) out.push(sel); }
  if (!out.length) {
    for (const g of f[10] || []) {
      if (!(g instanceof Uint8Array)) continue;
      for (const item of decode(g)[1] || []) {
        if (!(item instanceof Uint8Array)) continue;
        let added = false;
        for (const sub of decode(item)[1] || []) { if (!(sub instanceof Uint8Array)) continue; const sel = decodeSelection(sub); if (sel) { out.push(sel); added = true; } }
        if (!added) { const sel = decodeSelection(item); if (sel) out.push(sel); }
      }
    }
  }
  if (!out.length) { for (const sub of f[13] || []) if (sub instanceof Uint8Array) out.push(...extractSelections(sub)); }
  return out;
}

function extractMarkets(matchData, category) {
  const f = decode(matchData); const out = [];
  for (const wrapper of f[11] || []) {
    if (!(wrapper instanceof Uint8Array)) continue;
    const wf = decode(wrapper);
    for (const md of [...(wf[3] || []), ...(wf[1] || [])]) {
      if (!(md instanceof Uint8Array)) continue;
      const mf = decode(md);
      let name = null;
      for (const n of [2, 3]) { const s = asText(mf[n]?.[0]); if (s && s.length > 2) { name = s; break; } }
      if (!name) continue;
      const selections = extractSelections(md);
      if (!selections.length) continue;
      out.push({ id: asInt(mf[1]?.[0]), name, category, suspended: asInt(mf[9]?.[0]) === 3, selections });
    }
  }
  return out;
}

/** Une page de 40 matchs (le champ 4 est le decalage de pagination). */
export async function bcListPage(sport = 'football', { regulation = 'CI', offset = 0 } = {}) {
  const slug = BETCLIC_SPORTS[sport] || sport;
  const payload = [...fString(1, slug), ...fString(2, 'fr'), ...(offset ? fVarint(4, offset) : [])];
  const raw = await call('offering.access.api.MatchService', 'GetMatchesBySportWithNotifications', payload, regulation);
  const matches = [];
  for (const frame of frames(raw)) {
    for (const wrapper of decode(frame)[1] || []) {
      if (!(wrapper instanceof Uint8Array)) continue;
      for (const md of decode(wrapper)[3] || []) {
        if (!(md instanceof Uint8Array)) continue;
        const m = decodeMatch(md);
        if (m.id && m.home && m.away) matches.push(m);
      }
    }
  }
  return matches;
}

/** Tout le programme, page par page (le serveur repete la derniere page a la fin). */
export async function bcListAll(sport = 'football', { regulation = 'CI', maxMatches = 1600 } = {}) {
  const byId = new Map();
  for (let offset = 0; offset < maxMatches; offset += BETCLIC_PAGE) {
    let page;
    try { page = await bcListPage(sport, { regulation, offset }); } catch { break; }
    if (!page.length) break;
    let fresh = 0;
    for (const m of page) { if (byId.has(m.id)) continue; byId.set(m.id, m); fresh++; }
    if (!fresh) break;
  }
  return [...byId.values()];
}

/** Marches d'un match pour UNE categorie. */
async function bcCategory(matchId, category, regulation) {
  const payload = [...fVarint(1, matchId), ...fString(2, 'fr'), ...(category ? fString(3, category) : [])];
  const raw = await call('offering.access.api.MatchService', 'GetMatchWithNotification', payload, regulation);
  const markets = [];
  for (const frame of frames(raw)) {
    for (const wrapper of decode(frame)[1] || []) {
      if (!(wrapper instanceof Uint8Array)) continue;
      for (const md of decode(wrapper)[1] || []) {
        if (md instanceof Uint8Array) markets.push(...extractMarkets(md, category));
      }
    }
  }
  return markets;
}

/**
 * TOUS les marches arbitrables d'un match : chaque categorie est interrogee
 * puis les marches sont fusionnes. Le dedoublonnage se fait sur l'identifiant
 * technique Betclic : deux marches peuvent porter le meme nom (versions par
 * equipe) et un dedoublonnage par libelle en perdrait la moitie.
 */
export async function bcMatchMarkets(matchId, { regulation = 'CI', categories = ARB_CATEGORIES } = {}) {
  const results = await Promise.all(categories.map((c) => bcCategory(matchId, c, regulation).catch(() => [])));
  const seen = new Set(); const out = [];
  for (const list of results) {
    for (const mk of list) {
      const key = mk.id ? '#' + mk.id : mk.name + '|' + mk.selections.map((s) => s.id ?? s.name).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(mk);
    }
  }
  return out;
}
