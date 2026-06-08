import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const password = process.argv.includes('--stdin') ? readFileSync(0, 'utf8').replace(/\n$/, '') : process.argv[2];
if (!password) {
  console.error('Usage: npm run hash-password -- <password>');
  console.error('   or: printf "%s" "$PASSWORD" | node scripts/hash-password.mjs --stdin');
  process.exit(1);
}

const iterations = 100_000;
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256');

console.log(`pbkdf2$sha256$${iterations}$${base64url(salt)}$${base64url(hash)}`);

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
