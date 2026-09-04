// Utilitaires partagés pour les parseurs Betclic (libellés français).
// Le backend gRPC-web de Betclic ne renvoie AUCUN code technique de marché :
// tout se lit dans les libellés. Ces helpers normalisent le texte, extraient
// les demi-lignes et identifient l'équipe porteuse d'une sélection/marché.
import { isHalfLine } from '../../core/markets.js';

export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}
export function numFR(s) {
  const m = String(s || '').match(/(-?\d+(?:[.,]\d+)?)/);
  return m ? Number(m[1].replace(',', '.')) : null;
}
// Demi-ligne uniquement : les lignes entières (total 38, handicap -4) provoquent
// un remboursement et donc aucun arbitrage garanti.
export function halfLine(n) { return isHalfLine(n) ? String(n) : null; }

// Identifie le camp (home/away) à partir d'un texte.
//   mode 'start' : le texte COMMENCE par le nom de l'équipe (sélection de
//                  vainqueur / handicap — le nom est en tête).
//   mode 'in'    : le texte CONTIENT le nom de l'équipe (marché de total
//                  individuel — "Nombre total de points - Espagne F.").
// Un nom d'équipe peut être CONTENU dans l'autre ("IR Reykjavik" dans
// "Leiknir Reykjavik") : on retient toujours le nom le PLUS LONG qui correspond.
export function pickSide(hay, home, away, mode) {
  const h = norm(home), a = norm(away);
  const hit = (needle) => { if (!needle) return false; return mode === 'start' ? hay.startsWith(needle) : hay.includes(needle); };
  const okH = hit(h), okA = hit(a);
  if (okH && okA) return h.length >= a.length ? 'home' : 'away';
  if (okH) return 'home';
  if (okA) return 'away';
  return null;
}
export function sideOfSel(sel, home, away) { return pickSide(norm(sel), home, away, 'start'); }
export function sideIn(name, home, away) { return pickSide(name, home, away, 'in'); }

// put avec suivi des _ids (pour la génération de coupon Betclic via share API).
// Premier-wins : chaque marché Betclic apparaît une seule fois.
export function makePut(odds, ids) {
  return (key, sel, mk) => {
    if (!key || odds[key] != null) return;
    odds[key] = sel.odd;
    ids[key] = { market_id: mk.id, market_name: mk.name, selection_id: sel.id, selection_name: sel.name };
  };
}
