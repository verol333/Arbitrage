// ═══════════════════════════════════════════════════════════════════
// 1WIN — recherche d'un match et lecture de ses marchés « écart de buts ».
//
// La liste des matchs est en REST (matches/get-many, sportId 18 = football,
// pagination par offset). Les cotes arrivent en WebSocket (fetchOnewinOdds) :
// chaque groupe porte un nom lisible et une liste de cotes
// { id, name, outcome, cf, status, vars:{ v1 } } où v1 = ligne du handicap.
// ═══════════════════════════════════════════════════════════════════

import { fetchOnewinOdds } from './onewinResolve.ts';

const PLATFORM = "44ba10e5-7df2-47ab-a44d-dc93803c7a6e";
const API = "https://api-gateway.top-parser.com";
const ORIGIN = "https://1win.ng";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

export interface OnewinMatch { id: number; home: string; away: string; ts: number | null }

/** Liste des matchs de football 1win sur la fenêtre demandée (pagination complète). */
export async function listOnewin(fromTs: number, toTs: number): Promise<OnewinMatch[]> {
  const out: OnewinMatch[] = [];
  for (let offset = 0; offset < 2000; offset += 200) {
    const res = await fetch(`${API}/matches/get-many`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Referer: `${ORIGIN}/`, "User-Agent": UA },
      body: JSON.stringify({
        sportId: 18,
        startAtFrom: Math.floor(fromTs / 1000),
        startAtTo: Math.floor(toTs / 1000),
        limit: 200, offset, l: "fr-CI", p: PLATFORM,
      }),
      signal: AbortSignal.timeout(15000),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    const items = json?.result?.items || [];
    for (const m of items) {
      out.push({
        id: Number(m.id),
        home: String(m.homeTeam?.name || ""),
        away: String(m.awayTeam?.name || ""),
        ts: m.startAt ? Number(m.startAt) * 1000 : null,
      });
    }
    if (items.length < 200) break;
  }
  return out;
}

export { fetchOnewinOdds };

// ── Lecture des marchés « écart de buts » ──────────────────────────
// Groupes confirmés sur Barcelone - Athletic Bilbao (27/08) :
//   « Résultat du temps réglementaire » → out = 1 / x / 2
//   « Double chance »                   → out = 1x / x2 / 12
//   « Handicap » (asiatique, v1 = ligne appliquée à l'équipe affichée)
//        out=1, v1=-1.5 → domicile par 2+            = O(1)   [cote 1.92
//        out=2, v1= 0.5 → nul ou extérieur (X2)      = U(1)     vs 1.95
//        out=2, v1= 1.5 → domicile par 1 max ou moins= U(2)     chez 1xBet]
// Seules les lignes DEMI sont retenues : les lignes entières sont remboursées
// en cas d'égalité exacte et les quarts (0.25 / 0.75) coupent la mise en deux —
// ni l'une ni l'autre ne décrit une issue nette.

import { type Atom, E, O, U } from './handicapLadder.ts';

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 1 ? n : null; };
const isHalf = (n: number) => Number.isFinite(n) && Math.abs(Math.abs(n % 1) - 0.5) < 1e-9;
const gname = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

export function readOnewin(groups: Record<string, any[]>): Record<Atom, { odds: number; market: string }> {
  const out: Record<Atom, { odds: number; market: string }> = {};
  const put = (atom: Atom, odds: number | null, market: string) => {
    if (odds && (!out[atom] || odds > out[atom].odds)) out[atom] = { odds, market };
  };

  for (const [rawName, list] of Object.entries(groups)) {
    const g = gname(rawName);
    const is1x2 = g === "resultat du temps reglementaire";
    const isDC = g === "double chance";
    const isHcp = g === "handicap";
    if (!is1x2 && !isDC && !isHcp) continue;

    for (const o of list || []) {
      if (Number(o?.status) !== 1) continue;
      const c = num(o?.cf);
      if (!c) continue;
      const side = String(o?.outcome || "").toLowerCase();
      if (is1x2) {
        if (side === "1") put(O(0), c, "1X2");
        if (side === "x") put(E(0), c, "1X2");
        if (side === "2") put(U(0), c, "1X2");
      } else if (isDC) {
        if (side === "1x") put(O(-1), c, "Double chance 1X");
        if (side === "x2") put(U(1), c, "Double chance X2");
      } else {
        const v = Number(o?.vars?.v1);
        if (!isHalf(v)) continue;
        if (side === "1") put(O(-v - 0.5), c, `HA dom ${v}`);
        if (side === "2") put(U(v + 0.5), c, `HA ext ${v}`);
      }
    }
  }
  return out;
}