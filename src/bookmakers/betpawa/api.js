// BetPawa API — endpoint découvert via probe.
// TODO: câbler BASE + PARAMS après résultat du probe (scripts/probe-betpawa.js).
export const BASE = 'https://www.betpawa.cg';

export const HDR = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
  'X-Pawa-Language': 'fr',
  'X-Pawa-Brand': 'betpawa-congo',
};

export async function bpGet(path, extra = {}, timeoutMs = 15_000) {
  const url = `${BASE}${path}`;
  try {
    const res = await fetch(url, {
      headers: HDR,
      signal: AbortSignal.timeout(timeoutMs),
      ...extra,
    });
    if (!res.ok) { console.log(`[betpawa] ${path} status=${res.status}`); return null; }
    return res.json();
  } catch (e) {
    console.log(`[betpawa] ${path} err=${e.message}`);
    return null;
  }
}

export const isVirtual = (s) => /\bcyber|esoccer|e-?soccer|virtual|simulated|\bsrl\b|\bfifa\b/i.test(s || '');

export function splitTeams(name) {
  const s = String(name || '');
  const parts = s.split(/\s+[-–]\s+|\s+vs\s+/i);
  if (parts.length < 2) return null;
  return { home: parts[0].trim(), away: parts.slice(1).join(' - ').trim() };
}
