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

// ---- password policy ---------------------------------------------------------
// Modelled on NIST SP 800-63B: favour LENGTH over forced composition, block known
// weak/common secrets, and never silently truncate. Composition variety is only
// required for shorter passwords; a long passphrase is accepted as-is.
export const PASSWORD_MIN_LENGTH = 12;
/** At or above this length a passphrase needs no character-class variety. */
export const PASSPHRASE_LENGTH = 16;
export const PASSWORD_MAX_LENGTH = 200;

/** Most-abused passwords/patterns. Compared case-insensitively, substring-aware. */
const COMMON = [
  'password', 'passw0rd', 'letmein', 'welcome', 'admin', 'administrator', 'qwerty',
  'azerty', 'iloveyou', 'monkey', 'dragon', 'football', 'baseball', 'sunshine',
  'princess', 'superman', 'trustno1', 'changeme', 'default', 'secret', 'access',
  'master', 'shadow', 'michael', 'jennifer', 'hunter2', 'abc123', 'qazwsx',
  'starwars', 'whatever', 'freedom', 'ninja', 'login', 'hdsearch', 'hackerdogs',
];

/** Long digit/letter runs like 123456789 or abcdefgh. */
function hasLongSequence(s: string): boolean {
  const lower = s.toLowerCase();
  let run = 1;
  for (let i = 1; i < lower.length; i++) {
    const d = lower.charCodeAt(i) - lower.charCodeAt(i - 1);
    run = d === 1 || d === -1 ? run + 1 : 1;
    if (run >= 5) return true;
  }
  return false;
}

/**
 * Password policy for local accounts. Returns an error string, or null when valid.
 * `identifier` (e.g. the email) is rejected as a substring so "alice@x.com" can't
 * use "alice12345678".
 */
export function validatePassword(plain: string, identifier?: string): string | null {
  if (typeof plain !== 'string') return 'password is required';
  if (plain.length < PASSWORD_MIN_LENGTH) {
    return `password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (plain.length > PASSWORD_MAX_LENGTH) return 'password is too long';
  if (plain.trim().length !== plain.length) return 'password cannot start or end with a space';

  const lower = plain.toLowerCase();

  // Never let the account identifier (or its local part) be the password material.
  if (identifier) {
    const id = identifier.trim().toLowerCase();
    const local = id.split('@')[0] || '';
    if (id && id.length >= 3 && lower.includes(id)) return 'password must not contain your email';
    if (local && local.length >= 3 && lower.includes(local)) return 'password must not contain your name or email';
  }

  if (COMMON.some((w) => lower.includes(w))) return 'password is too common — choose something less guessable';
  if (/^(.)\1+$/.test(plain)) return 'password cannot be a single repeated character';
  if (hasLongSequence(plain)) return 'password cannot contain long sequences like 12345 or abcde';

  // Long passphrases are accepted without composition rules (NIST guidance).
  if (plain.length >= PASSPHRASE_LENGTH) return null;

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(plain)).length;
  if (classes < 3) {
    return `passwords under ${PASSPHRASE_LENGTH} characters need at least 3 of: lowercase, uppercase, number, symbol (or use a longer passphrase)`;
  }
  return null;
}
