import { describe, expect, it } from 'vitest';
import { assertAllowedOrigin } from './cors';

describe('CORS origin guard', () => {
  it('allows exact whitelisted GitHub Pages origins', () => {
    expect(assertAllowedOrigin('https://example.github.io', 'https://example.github.io,https://law.example.com')).toBe(
      'https://example.github.io'
    );
  });

  it('rejects non-whitelisted origins', () => {
    expect(assertAllowedOrigin('https://evil.example', 'https://example.github.io')).toBeNull();
    expect(assertAllowedOrigin(null, 'https://example.github.io')).toBeNull();
  });

  it('allows github pages wildcard origins without allowing arbitrary domains', () => {
    expect(assertAllowedOrigin('https://lawfirm.github.io', 'https://*.github.io')).toBe('https://lawfirm.github.io');
    expect(assertAllowedOrigin('https://github.io.evil.example', 'https://*.github.io')).toBeNull();
  });
});
