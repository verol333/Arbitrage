// Scanner buts continu : enchaîne des cycles de 30 min qui se chevauchent de 30 s (aucun temps mort).
const MODE = Deno.env.get("MODE") || "buts";
const MINUTES = Number(Deno.env.get("SCAN_DURATION_MINUTES") || 350);
const CYCLE = Number(Deno.env.get("SCAN_MAX_S") || 1800);
let handler: ((r: Request) => Promise<Response>) | null = null;
(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve() }; };
await import("./base44/functions/goalLagScan/entry.ts");
const end = Date.now() + MINUTES * 60e3 - 3 * 60e3;
const runs: Promise<void>[] = [];
while (true) {
  const len = Math.floor(Math.min(CYCLE, (end - Date.now()) / 1000));
  if (len < 60) {
    // Relais : la machine suivante démarre avant la fin de celle-ci (chevauchement, aucun trou)
    if (MODE === "buts") {
      const r = await fetch(`https://api.github.com/repos/${Deno.env.get("GITHUB_REPOSITORY")}/actions/workflows/goal-scanner.yml/dispatches`, {
        method: "POST", headers: { Authorization: `Bearer ${Deno.env.get("GITHUB_TOKEN")}`, Accept: "application/vnd.github+json" },
        body: JSON.stringify({ ref: "main", inputs: { duration: "350" } }),
      }).catch(() => null);
      console.log("relais lancé", r?.status);
    }
    break;
  }
  console.log(new Date().toISOString(), "cycle", MODE, len + "s");
  runs.push(handler!(new Request("http://local/", { method: "POST", body: JSON.stringify({ seconds: len, mode: MODE }) }))
    .then((r) => r.json()).then((j) => console.log(JSON.stringify(j).slice(0, 600))).catch((e) => console.error("cycle échoué", e)));
  await new Promise((s) => setTimeout(s, (len - 30) * 1000));
}
await Promise.all(runs);
