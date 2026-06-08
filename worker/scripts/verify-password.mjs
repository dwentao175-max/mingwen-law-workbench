import { pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

const stored = process.argv[2];
const password = readFileSync(0, 'utf8').replace(/\n$/, '');

if (!stored || !password) {
  console.error('Usage: printf "%s" "$PASSWORD" | node scripts/verify-password.mjs <stored-hash>');
  process.exit(2);
}

const parts = stored.trim().split('$');
if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') {
  console.log('no');
  process.exit(0);
}

const iterations = Number(parts[2]);
const salt = unbase64url(parts[3]);
const expected = unbase64url(parts[4]);
const actual = pbkdf2Sync(password, salt, iterations, expected.length, 'sha256');
console.log(timingSafeEqual(actual, expected) ? 'yes' : 'no');

function unbase64url(value) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='), 'base64');
}
