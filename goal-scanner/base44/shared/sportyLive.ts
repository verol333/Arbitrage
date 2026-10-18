// SportyBet en direct — OBSERVATION SEULE. Relevé le 17/10/2026 :
//  /api/ng/factsCenter/liveOrPrematchEvents?sportId=sr:sport:1 : TOUS les matchs en direct avec tous
//  leurs marchés en une lecture (~6 Mo). Marché id 18 = plus/moins du match, specifier « total=2.5 »,
//  status 0 = ouvert, outcome.isActive 1 = jouable. Score « setScore » 1:0, minute « playedSeconds » 86:25.
const URL = "https://www.sportybet.com/api/ng/factsCenter/liveOrPrematchEvents?sportId=sr%3Asport%3A1";
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124" };
const FAKE = /virtu|cyber|esoccer|e-soccer|fifa|simulat|srl/i;

export async function spList() {
  const r = await fetch(`${URL}&_t=${Date.now()}`, { headers: H, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`sportybet ${r.status}`);
  const j = await r.json();
  const out: any[] = [];
  for (const t of j.data || []) for (const e of t.events || []) {
    const sc = String(e.setScore || "").split(":").map(Number);
    if (sc.length !== 2 || !sc.every(Number.isFinite) || FAKE.test(`${e.homeTeamName} ${e.awayTeamName} ${t.name}`)) continue;
    const mk: Record<string, number[]> = {}, locked = new Set<string>();
    for (const m of e.markets || []) {
      if (String(m.id) !== "18") continue;
      const ln = Number(String(m.specifier || "").replace("total=", ""));
      if ((ln * 2) % 2 !== 1) continue;
      const o = m.outcomes?.find((x: any) => /^Over/.test(x.desc)), u = m.outcomes?.find((x: any) => /^Under/.test(x.desc));
      if (!o || !u || !(Number(o.odds) > 1) || !(Number(u.odds) > 1)) continue;
      const k = `TOT_${ln}`;
      mk[k] = [Number(o.odds), Number(u.odds)];
      if (m.status !== 0 || !o.isActive || !u.isActive) locked.add(k);
    }
    const min = parseInt(String(e.playedSeconds || ""));
    out.push({ id: e.eventId, home: e.homeTeamName, away: e.awayTeamName, league: t.name, min: Number.isFinite(min) ? min : null, score: sc as [number, number], mk, locked });
  }
  return out;
}