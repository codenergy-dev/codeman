import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";
const INFO = "codeman/openrouter-task-key";
export const MIN_SECRET_LENGTH = 32;

/**
 * Encrypts a value that must travel between jobs. Job outputs appear in plain text in the logs
 * of the jobs that read them, so the task key is encrypted with a secret both jobs share.
 * AES-256-GCM, with a key derived by HKDF-SHA256 from the secret and a random salt.
 */
export function encrypt(plaintext: string, secret: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret, salt), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, salt, iv, cipher.getAuthTag(), data]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decrypt(token: string, secret: string): string {
  const [version, salt, iv, tag, data, ...rest] = token.split(".");
  if (version !== VERSION || !salt || !iv || !tag || !data || rest.length > 0) {
    throw new Error("The encrypted key has an unknown format.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(secret, Buffer.from(salt, "base64url")),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`The encryption secret must have at least ${MIN_SECRET_LENGTH} characters.`);
  }
  return Buffer.from(hkdfSync("sha256", secret, salt, INFO, 32));
}
