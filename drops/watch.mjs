// Veilleur des chutes de cote — virtuel FIFA Megapari, cotes lues chaque seconde.
// Une chute = cote qui perd au moins 15 % en moins de 10 s SANS changement de score.
const FEED = "https://megapari.com/service-api/LiveFeed/Get1x2_VZip?sports=85&count=300&lng=fr&mode=4&country=93&getEmpty=true&virtualSports=true";
const HOOK = "https://al-ve-pro.base44.app/functions/oddsDropWebhook";
const SECRET = process.env.WEBHOOK_SECRET;
const END = Date.now() + Number(process.env.DURATION_MINUTES || 5) * 60000;
const DROP = 0.15, WINDOW = 10000, COOLDOWN = 60000, GONE = 60000;
const EXCLUDE = /penal|rush|volta|\b[2-9]\s?x\s?[2-9]\b/i;
const H = { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36" };
import { createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
// Relevé complet : chaque cote de buts lue (une ligne dès qu'elle change, et
// au moins une fois par match et par ligne) -> fichier joint au run GitHub.
const gz = createGzip(); gz.pipe(createWriteStream("ticks.jsonl.gz"));
const lastOdd = new Map(); let rows = 0, liveCount = 0, linesRead = 0;
const matches = new Map();
const CONFIRM = 5000; // une chute attend 5 s : si un but s'affiche entre-temps, elle est annulée
let pending = [], live = new Set();
let drops = [], finals = [], lastFlush = Date.now(), ticks = 0, errors = 0;

function selection(e) {
  if (e.G === 17 && (e.T === 9 || e.T === 10)) return { market: "TOTAL", label: (e.T === 9 ? "Plus " : "Moins ") + e.P };
  return null;
}
function minuteOf(sc) {
  const m = String(sc.SLS || "").match(/(\d+)\s*min/);
  return m ? Number(m[1]) : Math.floor((sc.TS || 0) / 60);
}

async function tick() {
  const now = Date.now();
  const r = await fetch(FEED, { headers: H, signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const games = (await r.json()).Value || [];
  liveCount = 0; linesRead = 0;
  for (const g of games) {
    const sc = g.SC || {};
    if (EXCLUDE.test(g.L || "") || sc.GS === 128 || /d[ée]but|dans/i.test(sc.SLS || "")) continue;
    const score = (sc.FS?.S1 || 0) + "-" + (sc.FS?.S2 || 0);
    let m = matches.get(g.I);
    if (!m) { m = { score, hist: {}, cool: {} }; matches.set(g.I, m); }
    Object.assign(m, { seen: now, minute: minuteOf(sc), info: { match_id: g.I, champ_id: g.LI, league: g.L, team_home: g.O1, team_away: g.O2 } });
    liveCount++;
    if (m.score !== score) {
      // But : toute la mémoire des cotes est effacée, et les chutes en attente
      // de ce match sont annulées (c'est le but qui a fait baisser la cote).
      const n = pending.length;
      pending = pending.filter((p) => p.match_id !== g.I);
      if (n !== pending.length) console.log("annulée (but)", g.O1, "-", g.O2, m.score, "->", score);
      m.score = score; m.hist = {}; m.goalAt = now;
    }
    if (m.goalAt && now - m.goalAt < 3000) continue; // cotes encore en réajustement après un but
    for (const e of g.E || []) {
      const s = selection(e);
      if (!s || !s.label || !e.C) continue;
      const key = e.G + "/" + e.T + "/" + (e.P ?? "");
      linesRead++;
      const lk = g.I + "|" + key;
      if (lastOdd.get(lk) !== e.C) { lastOdd.set(lk, e.C); rows++;
        gz.write(JSON.stringify({ t: now, id: g.I, l: g.L, h: g.O1, a: g.O2, min: m.minute, s: score, k: key, c: e.C }) + "\n"); }
      const h = (m.hist[key] = (m.hist[key] || []).filter(([t]) => now - t <= WINDOW));
      h.push([now, e.C]);
      const top = h.reduce((a, b) => (b[1] > a[1] ? b : a));
      if (top[1] <= 10 && e.C >= 1.1 && e.C <= top[1] * (1 - DROP) && !(m.cool[key] > now)) {
        m.cool[key] = now + COOLDOWN;
        pending.push({ due: now + CONFIRM, ...m.info, market: s.market, selection: s.label, market_key: key, odd_before: top[1], odd_after: e.C,
          drop_pct: Math.round((1 - e.C / top[1]) * 1000) / 10, window_sec: Math.round((now - top[0]) / 100) / 10,
          minute: m.minute, score_at_drop: score, detected_at: new Date(now).toISOString() });
        console.log("candidate", g.O1, "-", g.O2, s.label, top[1], "->", e.C, "min", m.minute, score);
      }
    }
  }
  for (const p of pending.filter((p) => p.due <= now)) {
    const m = matches.get(p.match_id);
    if (!m || m.score !== p.score_at_drop) continue;
    const { due, ...d } = p; drops.push(d); live.add(p.match_id);
    console.log("CHUTE CONFIRMÉE", d.team_home, "-", d.team_away, d.selection, d.odd_before, "->", d.odd_after, d.minute + "'", d.score_at_drop);
  }
  pending = pending.filter((p) => p.due > now);
  for (const [id, m] of matches) if (now - m.seen > GONE) {
    live.delete(id);
    finals.push({ match_id: id, final_score: m.score, final_minute: m.minute });
    matches.delete(id);
  }
}

async function flush() {
  const liveRows = [...live].map((id) => matches.get(id)).filter(Boolean).map((m) => ({ match_id: m.info.match_id, score: m.score, minute: m.minute }));
  if (!drops.length && !finals.length && !liveRows.length) return;
  const body = JSON.stringify({ drops, finals, live: liveRows });
  const r = await fetch(HOOK, { method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": SECRET }, body, signal: AbortSignal.timeout(30000) }).catch((e) => ({ ok: false, status: e.message }));
  if (r.ok) { drops = []; finals = []; } else console.log("envoi refusé", r.status);
}

while (Date.now() < END) {
  const t0 = Date.now();
  try { await tick(); ticks++; } catch (e) { errors++; if (errors % 30 === 1) console.log("lecture", e.message); }
  if (Date.now() - lastFlush > 5000) { lastFlush = Date.now(); await flush(); }
  if (ticks % 60 === 0) console.log("tours", ticks, "| erreurs", errors, "| matchs en cours", liveCount, "| cotes lues ce tour", linesRead, "| relevés", rows, "| en attente", pending.length);
  await new Promise((r) => setTimeout(r, Math.max(0, 1000 - (Date.now() - t0))));
}
await flush();
await new Promise((r) => gz.end(r));
console.log("fin", ticks, "tours", errors, "erreurs");
