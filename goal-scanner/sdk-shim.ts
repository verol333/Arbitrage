// Remplace le SDK de l'application : chaque lecture/écriture part vers la porte d'entrée goalLagIngest.
const URL_ = Deno.env.get("INGEST_URL")!, SECRET = Deno.env.get("WEBHOOK_SECRET")!;
const call = async (entity: string, op: string, args: unknown[]) => {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": SECRET }, body: JSON.stringify({ entity, op, args }) }).catch(() => null);
    if (r?.ok) return (await r.json()).result;
    if (r && r.status < 500 && r.status !== 429) throw new Error(`${entity}.${op} ${r.status}`);
    await new Promise((s) => setTimeout(s, 1500 * (i + 1)));
  }
  throw new Error(`${entity}.${op} indisponible`);
};
const entities = new Proxy({}, { get: (_, entity) => new Proxy({}, { get: (_, op) => (...args: unknown[]) => call(String(entity), String(op), args) }) });
export const createClientFromRequest = (_req: Request) => ({ auth: { me: async () => null }, asServiceRole: { entities } });
