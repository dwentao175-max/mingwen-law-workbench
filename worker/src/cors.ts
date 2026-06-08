export function assertAllowedOrigin(origin: string | null, whitelist: string): string | null {
  if (!origin) return null;
  const allowed = whitelist
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return allowed.some((item) => matchesOrigin(origin, item)) ? origin : null;
}

export function corsHeaders(origin: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function matchesOrigin(origin: string, allowed: string): boolean {
  if (origin === allowed) return true;
  if (allowed === 'https://*.github.io') {
    try {
      const url = new URL(origin);
      return url.protocol === 'https:' && url.hostname.endsWith('.github.io');
    } catch {
      return false;
    }
  }
  return false;
}
