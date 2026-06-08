import type { Role, TokenPayload } from './types';

const ITERATIONS = 100_000;
const MAX_WORKER_PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

export async function hashPassword(password: string, salt = randomBytes(SALT_BYTES)): Promise<string> {
  const key = await derivePassword(password, salt);
  return `pbkdf2$sha256$${ITERATIONS}$${base64url(salt)}$${base64url(key)}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.trim().split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') return false;
  const iterations = Number(parts[2]);
  if (!Number.isFinite(iterations) || iterations < 10_000) return false;
  if (iterations > MAX_WORKER_PBKDF2_ITERATIONS) return false;
  const salt = unbase64url(parts[3]);
  const expected = unbase64url(parts[4]);
  const actual = await derivePassword(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

export async function signToken(payload: TokenPayload, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const unsigned = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const signature = await hmac(unsigned, secret);
  return `${unsigned}.${base64url(signature)}`;
}

export async function verifyToken(token: string | null, secret: string): Promise<TokenPayload | null> {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = await hmac(`${header}.${payload}`, secret);
  if (!timingSafeEqual(unbase64url(signature), expected)) return null;
  try {
    const decoded = JSON.parse(new TextDecoder().decode(unbase64url(payload))) as TokenPayload;
    if (!isRole(decoded.role) || decoded.exp <= Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function tokenFromRequest(request: Request): string | null {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length).trim();
}

function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'user';
}

async function derivePassword(password: string, salt: Uint8Array, iterations = ITERATIONS): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    KEY_BITS
  );
  return new Uint8Array(bits);
}

async function hmac(input: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign'
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
  return new Uint8Array(signature);
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function base64urlJson(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function unbase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}
