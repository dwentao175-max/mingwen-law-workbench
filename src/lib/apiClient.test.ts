import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiText } from './apiClient';

describe('apiClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('reports plain-text 524 responses as a readable timeout error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('error code: 524', {
        status: 524,
        headers: { 'Content-Type': 'text/plain' }
      })
    );

    await expect(apiText({ messages: [] }, 'token')).rejects.toThrow('AI 服务响应超时');
  });
});
