// Local password hashing for self-hosted auth. Uses Node's built-in scrypt (a
// memory-hard KDF) so there is ZERO extra dependency — important for an easy-to-run
// open-source deployment. Stored format is self-describing so parameters can evolve:
//   scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384; // CPU/memory cost (2^14)
const r = 8;
const p = 1;
const KEYLEN = 64;
// scrypt needs maxmem >= 128*N*r; the default (32MB) is too low for N=16384,r=8.
const MAXMEM = 128 * N * r * 2;

/** Hash a plaintext password into a self-describing scrypt string. */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(plain, salt, KEYLEN, { N, r, p, maxmem: MAXMEM });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${dk.toString('hex')}`;
}

/** Constant-time verify a plaintext password against a stored hash. */
export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  try {
    const [scheme, nStr, rStr, pStr, saltHex, hashHex] = stored.split('$');
    if (scheme !== 'scrypt' || !nStr || !rStr || !pStr || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const nn = Number(nStr);
    const rr = Number(rStr);
    const dk = scryptSync(plain, salt, expected.length, {
      N: nn,
      r: rr,
      p: Number(pStr),
      maxmem: 128 * nn * rr * 2,
    });
    return dk.length === expected.length && timingSafeEqual(dk, expected);
  } catch {
    return false;
  }
}

/** Minimum password policy for local accounts. Returns an error string or null. */
export function validatePassword(plain: string): string | null {
  if (typeof plain !== 'string' || plain.length < 8) return 'password must be at least 8 characters';
  if (plain.length > 200) return 'password is too long';
  return null;
}
