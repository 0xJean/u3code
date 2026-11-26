import * as NodeCrypto from "node:crypto";

export function newId(prefix: string): string {
  const ts = Date.now().toString(36).padStart(9, "0");
  const rand = NodeCrypto.randomBytes(8).toString("hex");
  return `${prefix}_${ts}${rand}`;
}

export function sha256Hex(value: string): string {
  return NodeCrypto.createHash("sha256").update(value).digest("hex");
}

export function verifyHmacSha256(
  secret: string,
  payload: string,
  signatureHeader: string,
): boolean {
  const expected = `sha256=${NodeCrypto.createHmac("sha256", secret).update(payload).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return NodeCrypto.timingSafeEqual(a, b);
}

function deriveAesKey(secret: string): Buffer {
  return NodeCrypto.createHash("sha256").update(secret).digest();
}

export function encryptSecretJson(secret: string, value: unknown): string {
  const iv = NodeCrypto.randomBytes(12);
  const cipher = NodeCrypto.createCipheriv("aes-256-gcm", deriveAesKey(secret), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptSecretJson<T>(secret: string, encoded: string): T {
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = NodeCrypto.createDecipheriv("aes-256-gcm", deriveAesKey(secret), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext) as T;
}
