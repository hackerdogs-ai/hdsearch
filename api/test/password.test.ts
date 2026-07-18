import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  validatePassword,
  PASSWORD_MIN_LENGTH,
  PASSPHRASE_LENGTH,
} from '../src/password.js';

describe('hashPassword / verifyPassword', () => {
  it('round-trips and is salted (same input → different hash)', () => {
    const a = hashPassword('correct horse battery staple');
    const b = hashPassword('correct horse battery staple');
    expect(a).not.toBe(b);
    expect(verifyPassword('correct horse battery staple', a)).toBe(true);
    expect(verifyPassword('correct horse battery staple', b)).toBe(true);
  });

  it('rejects a wrong password and a null hash', () => {
    const h = hashPassword('correct horse battery staple');
    expect(verifyPassword('wrong horse battery staple', h)).toBe(false);
    expect(verifyPassword('anything', null)).toBe(false);
    expect(verifyPassword('anything', 'not-a-hash')).toBe(false);
  });
});

describe('validatePassword', () => {
  it('accepts a compliant short-ish password with 3+ character classes', () => {
    expect(validatePassword('Tr0ubadour!x')).toBeNull(); // 12 chars, 4 classes
  });

  it('accepts a long passphrase without composition rules', () => {
    const pass = 'window teapot ranger clover';
    expect(pass.length).toBeGreaterThanOrEqual(PASSPHRASE_LENGTH);
    expect(validatePassword(pass)).toBeNull();
  });

  it('rejects anything shorter than the minimum', () => {
    expect(validatePassword('Ab1!xyz')).toMatch(/at least/);
    expect(validatePassword('x'.repeat(PASSWORD_MIN_LENGTH - 1))).toMatch(/at least/);
  });

  it('rejects short passwords lacking character variety', () => {
    expect(validatePassword('kjhgfdsaqwmn')).toMatch(/at least 3 of/); // 12 chars, 1 class
  });

  it('rejects common passwords and obvious patterns', () => {
    expect(validatePassword('Password123!')).toMatch(/too common/);
    expect(validatePassword('MyHdsearchPw1!')).toMatch(/too common/);
    expect(validatePassword('aaaaaaaaaaaaaa')).toMatch(/repeated character/);
    expect(validatePassword('Zx!abcdefghij')).toMatch(/sequences/);
  });

  it('rejects a password containing the account email or its local part', () => {
    expect(validatePassword('alice-Str0ng!pw', 'alice@example.com')).toMatch(/must not contain/);
    expect(validatePassword('Str0ng!alice@example.com', 'alice@example.com')).toMatch(/must not contain/);
  });

  it('rejects padded/oversized input', () => {
    expect(validatePassword('  Tr0ubadour!x  ')).toMatch(/space/);
    expect(validatePassword('A1!' + 'z'.repeat(300))).toMatch(/too long/);
  });
});
