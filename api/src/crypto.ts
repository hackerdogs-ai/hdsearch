// AES-256-GCM envelope for credentials at rest. Provider API keys configured by
// a user are encrypted before they touch Postgres and decrypted only in-process
// at call time. The master key comes from HDSEARCH_ENCRYPTION_KEY (32 bytes as
// hex or base64) and never leaves the environment.
//
// Wire format (string):  v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { env } from './env.js';

const VERSION = 'v1';

function masterKey(): Buffer {
  const raw = env.encryptionKey;
  if (!raw) {
    throw new Error(
      'HDSEARCH_ENCRYPTION_KEY is not set — cannot encrypt/decrypt stored credentials',
    );
  }
  // hex (64 chars) or base64; fall back to sha256 of an arbitrary passphrase.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  const b64 = Buffer.from(raw, 'base64');
  if (b64.length === 32) return b64;
  // last resort: derive 32 bytes deterministically so the app still boots
  return createHash('sha256').update(raw).digest();
}

export function encryptSecret(plaintext: string): string {
  const key = masterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('malformed encrypted secret');
  }
  const key = masterKey();
  const iv = Buffer.from(parts[1]!, 'base64');
  const tag = Buffer.from(parts[2]!, 'base64');
  const ct = Buffer.from(parts[3]!, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** True if encryption is configured (used to gate features that need it). */
export function encryptionAvailable(): boolean {
  return !!env.encryptionKey;
}

/** Show only the last 4 characters of a secret, e.g. ••••••cd34. */
export function maskSecret(secret: string): string {
  if (!secret) return '';
  const tail = secret.slice(-4);
  return `${'•'.repeat(Math.max(4, Math.min(12, secret.length - 4)))}${tail}`;
}
