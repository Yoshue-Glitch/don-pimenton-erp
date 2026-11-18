/** Doble factor TOTP (RFC 6238, SHA-1, 30 s, 6 dígitos) compatible con Google Authenticator / Microsoft Authenticator. */
import crypto from "crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(buf: Buffer) {
  let bits = 0, value = 0, out = "";
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string) {
  const clean = s.replace(/=+$/, "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0; const out: number[] = [];
  for (const c of clean) { value = (value << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newSecret = () => base32Encode(crypto.randomBytes(20));

export function totp(secret: string, at = Date.now(), step = 30) {
  const counter = Math.floor(at / 1000 / step);
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
  return code;
}
/** Acepta ±1 intervalo para tolerar desfase de reloj. */
export function verifyTotp(secret: string, code: string) {
  const c = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  return [-1, 0, 1].some((w) => crypto.timingSafeEqual(Buffer.from(totp(secret, Date.now() + w * 30000)), Buffer.from(c)));
}
export const otpauthUri = (secret: string, email: string) => `otpauth://totp/${encodeURIComponent("Don Pimentón ERP:" + email)}?secret=${secret}&issuer=${encodeURIComponent("Don Pimentón ERP")}&period=30&digits=6`;
