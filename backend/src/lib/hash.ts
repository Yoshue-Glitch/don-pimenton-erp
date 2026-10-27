import crypto from "crypto";

/** Serialización JSON canónica (claves ordenadas) para que el hash sea reproducible. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return "{" + Object.keys(obj).sort().filter((k) => obj[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canonical(obj[k])).join(",") + "}";
}

export const sha256Hex = (data: string | Buffer) => crypto.createHash("sha256").update(data).digest("hex");
export const sha256Bytes32 = (data: string | Buffer) => "0x" + sha256Hex(data);
export const hashObject = (obj: unknown) => sha256Bytes32(canonical(obj));
