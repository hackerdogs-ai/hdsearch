import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret, maskSecret, encryptionAvailable } from '../src/crypto.js';

describe('crypto (AES-256-GCM)', () => {
  it('round-trips a secret', () => {
    const plain = 'sk-test-ABC123!@#';
    const enc = encryptSecret(plain);
    expect(enc).toMatch(/^v1:/);
    expect(enc).not.toContain(plain);
    expect(decryptSecret(enc)).toBe(plain);
  });
  it('produces different ciphertext each time (random IV)', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });
  it('rejects tampered ciphertext', () => {
    const enc = encryptSecret('hello');
    const tampered = enc.slice(0, -4) + 'AAAA';
    expect(() => decryptSecret(tampered)).toThrow();
  });
  it('masks all but last 4 chars', () => {
    expect(maskSecret('abcd1234wxyz')).toMatch(/wxyz$/);
    expect(maskSecret('abcd1234wxyz')).not.toContain('abcd1234');
  });
  it('reports availability', () => {
    expect(encryptionAvailable()).toBe(true);
  });
});
