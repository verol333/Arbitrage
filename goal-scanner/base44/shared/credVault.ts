// Coffre des identifiants bookmaker : chiffrement AES-256-GCM côté serveur.
// Format stocké : "enc1:" + base64(iv 12 o | tag 16 o | données chiffrées).
// Les anciens blobs (base64 simple) restent lisibles et sont rechiffrés à la prochaine écriture.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";

const PREFIX = "enc1:";
const key = () => createHash("sha256").update("alve-cred-vault|" + (Deno.env.get("API_SECRET_KEY") || "")).digest();

export const isSealed = (blob: unknown) => typeof blob === "string" && blob.startsWith(PREFIX);

export function sealObj(obj: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function openBlob(blob: string): Record<string, any> | null {
  try {
    if (isSealed(blob)) {
      const raw = Buffer.from(blob.slice(PREFIX.length), "base64");
      const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
      d.setAuthTag(raw.subarray(12, 28));
      return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8"));
    }
    const bin = atob(blob);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
  } catch (_e) {
    return null;
  }
}

/** Rechiffre toute une carte { book: blob } (les blobs illisibles sont écartés). */
export function sealMap(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [bk, b] of Object.entries(map || {})) {
    if (isSealed(b)) out[bk] = b;
    else { const o = openBlob(b); if (o) out[bk] = sealObj(o); }
  }
  return out;
}