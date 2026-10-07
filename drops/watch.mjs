// Veilleur des chutes de cote — virtuel FIFA Megapari, cotes lues chaque seconde.
// Une chute = cote qui perd au moins 15 % en moins de 10 s SANS changement de score.
const FEED = "https://megapari.com/service-api/LiveFeed/Get1x2_VZip?sports=85&count=300&lng=fr&mode=4&country=93&getEmpty=true&virtualSports=true";
const HOOK = "https://al-ve-pro.base44.app/functions/oddsDropWebhook";
const SECRET = process.env.WEBHOOK_SECRET;
const END = Date.now() + Number(process.env.DURATION_MINUTES || 5) * 60000;
const DROP = 0.15, WINDOW = 10000, COOLDOWN = 60000, GONE = 60000;
const EXCLUDE = /penal|rush|volta|\b[2-9]\s?x\s?[2-9]\b/i;
const H = { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36" };
const matches = new Map();
let drops = [], finals = [], lastFlush = Date.now(), ticks = 0, errors = 0;

function selection(e) {
  if (e.G === 1) return { market: "1X2", label: { 1: "1", 2: "X", 3: "2" }[e.T] };
  if (e.G === 17 && (e.T === 9 || e.T === 10)) return { market: "TOTAL", label: (e.T === 9 ? "Plus " : "Moins ") + e.P };
  if (e.G === 19 && (e.T === 180 || e.T === 181)) return { market: "BTTS", label: e.T === 180 ? "BTTS Oui" : "BTTS Non" };
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
  for (const g of games) {
    const sc = g.SC || {};
    if (EXCLUDE.test(g.L || "") || sc.GS === 128 || /d[ée]but|dans/i.test(sc.SLS || "")) continue;
    const score = (sc.FS?.S1 || 0) + "-" + (sc.FS?.S2 || 0);
    let m = matches.get(g.I);
    if (!m) { m = { score, hist: {}, cool: {} }; matches.set(g.I, m); }
    Object.assign(m, { seen: now, minute: minuteOf(sc), info: { match_id: g.I, champ_id: g.LI, league: g.L, team_home: g.O1, team_away: g.O2 } });
    if (m.score !== score) { m.score = score; m.hist = {}; }
    for (const e of g.E || []) {
      const s = selection(e);
      if (!s || !s.label || !e.C) continue;
      const key = e.G + "/" + e.T + "/" + (e.P ?? "");
      const h = (m.hist[key] = (m.hist[key] || []).filter(([t]) => now - t <= WINDOW));
      h.push([now, e.C]);
      const top = h.reduce((a, b) => (b[1] > a[1] ? b : a));
      if (top[1] <= 10 && e.C >= 1.1 && e.C <= top[1] * (1 - DROP) && !(m.cool[key] > now)) {
        m.cool[key] = now + COOLDOWN;
        drops.push({ ...m.info, market: s.market, selection: s.label, market_key: key, odd_before: top[1], odd_after: e.C,
          drop_pct: Math.round((1 - e.C / top[1]) * 1000) / 10, window_sec: Math.round((now - top[0]) / 100) / 10,
          minute: m.minute, score_at_drop: score, detected_at: new Date(now).toISOString() });
        console.log("CHUTE", g.O1, "-", g.O2, s.label, top[1], "->", e.C, "min", m.minute, score);
      }
    }
  }
  for (const [id, m] of matches) if (now - m.seen > GONE) {
    finals.push({ match_id: id, final_score: m.score, final_minute: m.minute });
    matches.delete(id);
  }
}

async function flush() {
  if (!drops.length && !finals.length) return;
  const body = JSON.stringify({ drops, finals });
  const r = await fetch(HOOK, { method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": SECRET }, body, signal: AbortSignal.timeout(30000) }).catch((e) => ({ ok: false, status: e.message }));
  if (r.ok) { drops = []; finals = []; } else console.log("envoi refusé", r.status);
}

while (Date.now() < END) {
  const t0 = Date.now();
  try { await tick(); ticks++; } catch (e) { errors++; if (errors % 30 === 1) console.log("lecture", e.message); }
  if (Date.now() - lastFlush > 5000) { lastFlush = Date.now(); await flush(); }
  if (ticks % 300 === 0) console.log("tours", ticks, "erreurs", errors, "matchs suivis", matches.size);
  await new Promise((r) => setTimeout(r, Math.max(0, 1000 - (Date.now() - t0))));
}
await flush();
console.log("fin", ticks, "tours", errors, "erreurs");
