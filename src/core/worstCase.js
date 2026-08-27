// Solveur EXACT de repartition de mises (programmation lineaire, simplexe).
//
// Probleme : n options de pari, chacune payant sa cote sur un sous-ensemble de
// cases d issue. On cherche la repartition x (somme = 1 unite misee) qui
// MAXIMISE le pire des rendements. Pire cas > 1.00 = profit garanti.
//
// L ancien solveur etait une heuristique (poids multiplicatifs) : il pouvait
// s arreter avant l optimum et donc DECLARER 0 opportunite a tort. Ici le
// simplexe donne l optimum exact, sans approximation.

// maximise c.z sous Az <= b, z >= 0, avec b >= 0 (donc z = 0 est faisable).
function simplex(A, b, c) {
  const m = A.length, n = c.length;
  const T = A.map((row, i) => [...row, ...Array.from({ length: m }, (_, j) => (i === j ? 1 : 0)), b[i]]);
  T.push([...c.map((v) => -v), ...new Array(m).fill(0), 0]);
  const basis = Array.from({ length: m }, (_, i) => n + i);
  const W = n + m + 1;
  for (let guard = 0; guard < 5000; guard++) {
    let piv = -1;
    for (let j = 0; j < n + m; j++) if (T[m][j] < -1e-9) { piv = j; break; }   // regle de Bland
    if (piv < 0) break;
    let row = -1, best = Infinity;
    for (let i = 0; i < m; i++) {
      if (T[i][piv] > 1e-9) {
        const r = T[i][W - 1] / T[i][piv];
        if (r < best - 1e-12 || (Math.abs(r - best) < 1e-12 && basis[i] < basis[row])) { best = r; row = i; }
      }
    }
    if (row < 0) return null;                                                  // non borne
    const p = T[row][piv];
    for (let j = 0; j < W; j++) T[row][j] /= p;
    for (let i = 0; i <= m; i++) {
      if (i === row) continue;
      const f = T[i][piv];
      if (Math.abs(f) < 1e-14) continue;
      for (let j = 0; j < W; j++) T[i][j] -= f * T[row][j];
    }
    basis[row] = piv;
  }
  const z = new Array(n).fill(0);
  for (let i = 0; i < m; i++) if (basis[i] < n) z[basis[i]] = T[i][W - 1];
  return { z, value: T[m][W - 1] };
}

// legs : [{ key, odds, ... }] ; cells : liste des cases ; cover : key -> [cases]
export function solveWorstCase(legs, cells, cover) {
  if (!legs.length) return null;
  const n = legs.length, N = cells.length;
  const pay = legs.map((l) => cells.map((cl) => (cover[l.key].includes(cl) ? l.odds : 0)));
  // variables : x_0..x_{n-1}, t
  const A = [[...new Array(n).fill(1), 0]];                                    // somme des mises <= 1
  const b = [1];
  for (let i = 0; i < N; i++) { A.push([...pay.map((p) => -p[i]), 1]); b.push(0); }  // t <= rendement de chaque case
  const cvec = [...new Array(n).fill(0), 1];
  const sol = simplex(A, b, cvec);
  if (!sol) return null;
  const worst = sol.value;
  const tot = sol.z.slice(0, n).reduce((a, v) => a + v, 0) || 1;
  let mix = legs.map((l, k) => ({ leg: l, x: sol.z[k] / tot })).filter((e) => e.x > 1e-6);
  let wc = null, wv = Infinity;
  for (let i = 0; i < N; i++) {
    let v = 0;
    for (const e of mix) v += e.x * (cover[e.leg.key].includes(cells[i]) ? e.leg.odds : 0);
    if (v < wv) { wv = v; wc = cells[i]; }
  }
  return { mix, worst: Math.min(worst, wv), worstCell: wc };
}

// Auto-test : verifie que le solveur trouve bien un arbitrage quand il existe.
// Cas 1 : 6 options a cote 4.00 couvrant chacune 2 cases sur 6 -> 1/6 partout
//         rend 2 x 4 / 6 = 1.3333. Si le solveur rend moins, il est casse.
// Cas 2 : cotes realistes avec marge book -> doit rendre < 1.00.
export function selfTest(cells, cover) {
  const keys = Object.keys(cover);
  const arb = keys.map((k) => ({ key: k, odds: 4 }));
  const a = solveWorstCase(arb, cells, cover);
  const real = [3.4, 5.6, 4.3, 3.1, 4.9, 6.2].map((o, i) => ({ key: keys[i], odds: o }));
  const r = solveWorstCase(real, cells, cover);
  return {
    ok: !!a && Math.abs(a.worst - 4 / 3) < 1e-4 && !!r && r.worst < 1,
    arbWorst: a ? a.worst : null,
    realWorst: r ? r.worst : null,
  };
}
