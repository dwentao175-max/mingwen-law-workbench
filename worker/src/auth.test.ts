import { describe, expect, it } from 'vitest';
import { hashPassword, signToken, verifyPassword, verifyToken } from './auth';

describe('password hashing', () => {
  it('hashes with a salt and verifies only the original password', async () => {
    const hash = await hashPassword('correct-password');

    expect(hash).toMatch(/^pbkdf2\$sha256\$100000\$/);
    expect(hash).not.toContain('correct-password');
    await expect(verifyPassword('correct-password', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });

  it('accepts stored hashes with surrounding whitespace from CLI writes', async () => {
    const hash = await hashPassword('correct-password');

    await expect(verifyPassword('correct-password', `${hash}\n`)).resolves.toBe(true);
  });

  it('rejects hashes above the Cloudflare Worker PBKDF2 iteration limit without throwing', async () => {
    const hash = await hashPassword('correct-password');
    const unsupportedHash = hash.replace('pbkdf2$sha256$100000$', 'pbkdf2$sha256$120000$');

    await expect(verifyPassword('correct-password', unsupportedHash)).resolves.toBe(false);
  });
});

describe('signed tokens', () => {
  it('verifies a valid HMAC token and rejects tampering', async () => {
    const token = await signToken({ role: 'admin', exp: Math.floor(Date.now() / 1000) + 60 }, 'secret');
    const verified = await verifyToken(token, 'secret');
    const parts = token.split('.');
    const tamperedPayload = btoa(JSON.stringify({ role: 'user', exp: Math.floor(Date.now() / 1000) + 60 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    expect(verified?.role).toBe('admin');
    await expect(verifyToken(tampered, 'secret')).resolves.toBeNull();
  });

  it('rejects expired tokens', async () => {
    const token = await signToken({ role: 'user', exp: Math.floor(Date.now() / 1000) - 1 }, 'secret');

    await expect(verifyToken(token, 'secret')).resolves.toBeNull();
  });
});
