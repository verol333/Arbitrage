import { createPatient } from "../../shared/patientDrops.ts";

// Vérification des chutes patientes sur des matchs simulés (base factice, rien n'est enregistré)
function fakeDb() {
  const rows: any[] = []; let n = 0;
  return { rows, PatientDrop: {
    filter: async () => ({ items: [] }),
    create: async (d: any) => { const r = { id: `t${++n}`, ...d }; rows.push(r); return r; },
    update: async (id: string, d: any) => Object.assign(rows.find((r) => r.id === id), d),
    bulkUpdate: async (a: any[]) => a.forEach((d) => Object.assign(rows.find((r) => r.id === d.id) || {}, d)),
  } };
}
const wait = () => new Promise((r) => setTimeout(r, 5));

// steps : [secondes, minute, score, { "TOT_1.5": cote, ... }]
async function scenario(name: string, steps: any[], expect: any) {
  const db = fakeDb(); const p = await createPatient(db);
  const t0 = Date.now(), hist: any[] = [];
  for (const [sec, min, sc, mk] of steps) {
    const s = { at: t0 + sec * 1000, min, sc: sc.split("-").map(Number), mk: Object.fromEntries(Object.entries(mk).map(([k, v]) => [k, [v]])) };
    hist.push(s);
    p.feed("w", { id: 1, home: "A", away: "B" }, s as any, hist.filter((o) => s.at - o.at <= 180000));
    await wait();
  }
  await p.finish();
  const r = db.rows[0] || {};
  const ok = Object.entries(expect).every(([k, v]) => r[k] === v);
  return { name, ok, attendu: expect, obtenu: { status: r.status, kind: r.kind, line: r.line, signal_odd: r.signal_odd } };
}

export async function patientCheck() {
  const res = await Promise.all([
    scenario("Chute normale à 55', cote monte à 1.45 puis but → gagné", [
      [0, 55, "1-0", { "TOT_1.5": 1.6 }], [60, 56, "1-0", { "TOT_1.5": 1.25 }], [180, 58, "1-0", { "TOT_1.5": 1.45 }], [400, 62, "2-0", { "TOT_2.5": 1.5 }],
    ], { status: "won", kind: "normale", signal_odd: 1.45 }),
    scenario("Chute normale, but avant 1.40 → manqué", [
      [0, 60, "0-0", { "TOT_0.5": 1.5 }], [60, 61, "0-0", { "TOT_0.5": 1.2 }], [120, 62, "1-0", { "TOT_1.5": 1.3 }],
    ], { status: "missed" }),
    scenario("Chute normale, 1.40 jamais atteint en 5 min → expiré", [
      [0, 60, "0-0", { "TOT_0.5": 1.5 }], [60, 61, "0-0", { "TOT_0.5": 1.2 }], [200, 63, "0-0", { "TOT_0.5": 1.3 }], [400, 67, "0-0", { "TOT_0.5": 1.35 }],
    ], { status: "expired" }),
    scenario("Chute forte (plus de 2.5 à 0-0), but pendant l'attente → ligne suivante prise", [
      [0, 52, "0-0", { "TOT_2.5": 3.2, "TOT_0.5": 1.3 }], [60, 53, "0-0", { "TOT_2.5": 2.5, "TOT_0.5": 1.3 }], [200, 55, "1-0", { "TOT_1.5": 1.3 }], [400, 58, "1-0", { "TOT_1.5": 1.42 }],
    ], { status: "signal", kind: "forte", line: 1.5 }),
    scenario("Chute avant la 50e minute → ignorée", [
      [0, 40, "0-0", { "TOT_0.5": 1.5 }], [60, 41, "0-0", { "TOT_0.5": 1.2 }], [120, 42, "0-0", { "TOT_0.5": 1.5 }],
    ], { status: undefined }),
  ]);
  return { tout_ok: res.every((r) => r.ok), resultats: res };
}