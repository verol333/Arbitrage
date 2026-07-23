// Normalisation et fuzzy matching de noms d'equipes.
// Port fidele de matchCore.ts (norm/tokenOverlap/acronymMatch/levenshtein/teamSim).
const DIACRITICS = /[̀-ͯ]/g;

export function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(DIACRITICS, '')
    .replace(/\b(fc|cf|sc|ac|afc|cd|ec|sd|club|deportivo|universidad|u\.|de|del|do|da)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function tokenOverlap(a, b) {
  const ta = new Set(norm(a).split(' ').filter((w) => w.length >= 3));
  const tb = new Set(norm(b).split(' ').filter((w) => w.length >= 3));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

export function fuzzyEq(wa, wb) {
  if (wa === wb) return true;
  const lo = Math.min(wa.length, wb.length);
  if (lo < 4) return false;
  const d = levenshtein(wa, wb);
  return d <= (Math.max(wa.length, wb.length) <= 6 ? 1 : 2);
}

// Detecte si un nom court est l'ACRONYME d'un nom long (PSG↔Paris Saint Germain).
export function acronymMatch(a, b) {
  const acr = (s) => {
    const raw = (s || '').normalize('NFD').replace(DIACRITICS, '').trim();
    const words = raw.split(/\s+/).filter(Boolean);
    if (words.length !== 1) return null;
    const w = words[0];
    if (w.length < 2 || w.length > 5) return null;
    return w.toLowerCase().replace(/[^a-z]/g, '');
  };
  const initials = (s) => (s || '').normalize('NFD').replace(DIACRITICS, '')
    .split(/\s+/).filter((w) => w.length >= 2 && /^[a-z]/i.test(w))
    .map((w) => w[0].toLowerCase()).join('');
  const isSub = (ac, longN) => {
    const letters = (longN || '').normalize('NFD').replace(DIACRITICS, '').toLowerCase().replace(/[^a-z]/g, '');
    let i = 0;
    for (const ch of letters) { if (ch === ac[i]) i++; if (i === ac.length) return true; }
    return false;
  };
  const tryOne = (shortN, longN) => {
    const ac = acr(shortN);
    if (!ac || ac.length < 2) return false;
    const ini = initials(longN);
    if (ini.length >= 2 && ini.includes(ac)) return true;
    const words = (longN || '').trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2 && ini[0] === ac[0] && isSub(ac, longN)) return true;
    return false;
  };
  return tryOne(a, b) || tryOne(b, a);
}

// Similarite TOLERANTE d'equipe (overlap + prefixe + acronyme + fuzzy).
export function teamSim(a, b) {
  const base = tokenOverlap(a, b);
  if (acronymMatch(a, b)) return Math.max(base, 1);
  const ta = norm(a).split(' ').filter((w) => w.length >= 3);
  const tb = norm(b).split(' ').filter((w) => w.length >= 3);
  if (!ta.length || !tb.length) return base;
  let inter = 0;
  for (const wa of ta) {
    if (tb.some((wb) => wa === wb
      || (wa.length >= 4 && wb.startsWith(wa))
      || (wb.length >= 4 && wa.startsWith(wb))
      || fuzzyEq(wa, wb))) inter++;
  }
  return Math.max(base, inter / Math.min(ta.length, tb.length));
}
