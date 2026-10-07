// Veilleur des chutes de cote — virtuel FIFA Megapari, cotes lues chaque seconde.
// Une chute = cote qui perd >= 7 % en 10 s sans but, au-delà de l'effet du temps.
const FEED = "https://megapari.com/service-api/LiveFeed/Get1x2_VZip?sports=85&count=300&lng=fr&mode=4&country=93&getEmpty=true&virtualSports=true";
const HOOK = "https://al-ve-pro.base44.app/functions/oddsDropWebhook";
const SECRET = process.env.WEBHOOK_SECRET;
const END = Date.now() + Number(process.env.DURATION_MINUTES || 5) * 60000;
// Seuils : chute brute >= 7 % en 10 s, ET au moins 7 % de baisse EN PLUS de ce que
// le simple écoulement du temps explique (modèle de Poisson sur les buts restants).
// Après 80', les cotes bougent surtout avec le chrono : on ne signale plus rien.
const DROP = 0.05, EXCESS = 0.05, MIN_GAP = 2, WINDOW = 10000, COOLDOWN = 60000, MATCH_COOL = 90000, GONE = 60000, LAST_MIN = 80;
const poisCdf = (k, mu) => { if (k < 0) return 0; let t = Math.exp(-mu), c = t; for (let i = 1; i <= k; i++) { t *= mu / i; c += t; } return c; };
// Probabilité de la sélection selon le nombre de buts attendus (mu) d'ici la fin.
const probSel = (over, need, mu) => over ? 1 - poisCdf(need - 1, mu) : poisCdf(need - 1, mu);
// Cote attendue après le seul passage du temps (de min0 à min1), sans but.
function expectedOdd(over, line, goals, odd0, min0, min1) {
  const need = Math.floor(line) + 1 - goals; // buts nécessaires pour passer au-dessus
  if (need <= 0) return null;
  const p0 = Math.min(0.97, 0.95 / odd0), r0 = Math.max(1, 90 - min0), r1 = Math.max(0.5, 90 - min1);
  let lo = 0.001, hi = 15; // trouve mu tel que probSel(mu) = p0
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; const v = probSel(over, need, mid); if ((over ? v < p0 : v > p0)) lo = mid; else hi = mid; }
  const mu1 = ((lo + hi) / 2) * (r1 / r0);
  const p1 = probSel(over, need, mu1);
  return p1 > 0 ? odd0 * (p0 / p1) : null;
}
const tier = (x) => (x >= 0.2 ? "forte" : x >= 0.1 ? "moyenne" : "faible");
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
// Stratégie de patience : marge d'un but (ex : Moins 2.5 à 1-0) et cote >= 1.70 -> on vise
// un but de plus (Plus goals+0.5), mais on attend : entrée dès 5 min sans but si la cote Plus
// atteint 1.25, au plus tard 15 min après la chute (sinon on passe).
const patience = new Map(); let entries = [];
// Le flux principal ne donne qu'une ligne de buts : la cote du but supplémentaire
// est lue dans le détail du match, toutes les 8 s par match en attente.
async function plusOdd(id, line) {
  const r = await fetch(`https://megapari.com/service-api/LiveFeed/GetGameZip?id=${id}&lng=fr&isSubGames=true&GroupEvents=true&countevents=250&grMode=4&partner=192&marketType=1`, { headers: H, signal: AbortSignal.timeout(4000) }).catch(() => null);
  if (!r?.ok) return undefined;
  const ge = ((await r.json()).Value?.GE || []).find((x) => x.G === 17);
  const e = (ge?.E || []).flat().find((x) => x.T === 9 && Number(x.P) === line);
  return e ? e.C : null;
}
const PAT_MIN = 5, PAT_MAX = 15, PAT_ODD = 1.25;
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
    m.odds = {};
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
      m.odds[key] = e.C;
      const lk = g.I + "|" + key;
      if (lastOdd.get(lk) !== e.C) { lastOdd.set(lk, e.C); rows++;
        gz.write(JSON.stringify({ t: now, id: g.I, l: g.L, h: g.O1, a: g.O2, min: m.minute, s: score, k: key, c: e.C }) + "\n"); }
      const h = (m.hist[key] = (m.hist[key] || []).filter(([t]) => now - t <= WINDOW));
      h.push([now, e.C, m.minute]);
      const top = h.reduce((a, b) => (b[1] > a[1] ? b : a));
      if (top[1] > 10 || e.C < 1.1 || e.C > top[1] * (1 - DROP) || m.cool[key] > now || m.minute >= LAST_MIN || m.matchCool > now) continue;
      const [gh, ga] = score.split("-").map(Number);
      // Ligne à un seul but de basculer (ex : Moins 0.5 à 0-0, Moins 3.5 à 3-0) : la baisse est
      // mécanique avec le chrono, ce n'est pas une vraie chute. On exige au moins 2 buts d'écart.
      if (Math.floor(Number(e.P)) + 1 - (gh + ga) < MIN_GAP) continue;
      const exp = expectedOdd(e.T === 9, Number(e.P), gh + ga, top[1], top[2], m.minute);
      if (!exp) continue;
      const excess = 1 - e.C / exp;
      if (excess < EXCESS) continue; // baisse expliquée par le chrono
      m.cool[key] = now + COOLDOWN;
      const cand = { due: now + CONFIRM, ...m.info, market: s.market, selection: s.label, market_key: key, odd_before: top[1], odd_after: e.C,
        drop_pct: Math.round((1 - e.C / top[1]) * 1000) / 10, window_sec: Math.round((now - top[0]) / 100) / 10,
        expected_odd: Math.round(exp * 100) / 100, excess_pct: Math.round(excess * 1000) / 10, strength: tier(excess),
        minute: m.minute, score_at_drop: score, detected_at: new Date(now).toISOString() };
      // Anti-cascade : une seule chute par match en attente, la plus forte.
      const i = pending.findIndex((p) => p.match_id === g.I);
      if (i < 0) pending.push(cand); else if (pending[i].excess_pct < cand.excess_pct) pending[i] = { ...cand, due: pending[i].due };
      console.log("candidate", g.O1, "-", g.O2, s.label, top[1], "->", e.C, "attendue", cand.expected_odd, "excès", cand.excess_pct + "%", "min", m.minute, score);
    }
  }
  for (const p of pending.filter((p) => p.due <= now)) {
    const m = matches.get(p.match_id);
    if (!m || m.score !== p.score_at_drop) continue;
    const { due, ...d } = p; drops.push(d);
    const goals0 = d.score_at_drop.split("-").reduce((a, b) => a + Number(b), 0);
    if (d.selection.startsWith("Moins") && d.odd_after >= 1.7 && Math.floor(Number(d.market_key.split("/")[2])) + 1 - goals0 === 2)
      patience.set(d.match_id + "|" + d.detected_at, { match_id: d.match_id, detected_at: d.detected_at, minute: d.minute, goals: goals0, line: goals0 + 0.5 }); live.add(p.match_id); m.matchCool = now + MATCH_COOL;
    console.log("CHUTE CONFIRMÉE", d.team_home, "-", d.team_away, d.selection, d.odd_before, "->", d.odd_after, d.minute + "'", d.score_at_drop);
  }
  pending = pending.filter((p) => p.due > now);
  for (const [k, p] of patience) {
    const m = matches.get(p.match_id);
    if (!m) { patience.delete(k); continue; }
    const id = { match_id: p.match_id, detected_at: p.detected_at };
    const goals = m.score.split("-").reduce((a, b) => a + Number(b), 0);
    if (!p.next || now >= p.next) { p.next = now + 8000; const o = await plusOdd(p.match_id, p.line); if (o !== undefined) p.odd = o; }
    const odd = p.odd;
    if (odd != null) p.best = Math.max(p.best || 0, odd);
    if (p.start == null && odd) { p.start = odd; entries.push({ ...id, plus_selection: "Plus " + p.line, plus_odd_at_drop: odd, entry_status: "waiting" }); }
    const at = { entry_minute: m.minute, entry_score: m.score };
    if (goals > p.goals) { entries.push({ ...id, ...at, entry_status: "goal_before" }); patience.delete(k); continue; }
    const waited = m.minute - Math.max(p.minute, m.minute > 45 && p.minute >= 45 ? 45 : p.minute);
    if (odd && odd >= PAT_ODD && waited >= PAT_MIN) { entries.push({ ...id, ...at, entry_status: "entered", entry_odd: odd }); patience.delete(k); console.log("ENTRÉE patience", m.info.team_home, "-", m.info.team_away, "Plus", p.line, odd, m.minute + "'"); }
    else if (waited >= PAT_MAX) { entries.push({ ...id, ...at, entry_status: "skipped", entry_odd: p.best || null }); patience.delete(k); }
  }
  for (const [id, m] of matches) if (now - m.seen > GONE) {
    live.delete(id);
    finals.push({ match_id: id, final_score: m.score, final_minute: m.minute });
    matches.delete(id);
  }
}

async function flush() {
  const liveRows = [...live].map((id) => matches.get(id)).filter(Boolean).map((m) => ({ match_id: m.info.match_id, score: m.score, minute: m.minute }));
  if (!drops.length && !finals.length && !liveRows.length && !entries.length) return;
  const sent = entries.length;
  const body = JSON.stringify({ drops, finals, live: liveRows, entries });
  const r = await fetch(HOOK, { method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": SECRET }, body, signal: AbortSignal.timeout(30000) }).catch((e) => ({ ok: false, status: e.message }));
  if (r.ok) { drops = []; finals = []; entries = entries.slice(sent); } else console.log("envoi refusé", r.status);
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
