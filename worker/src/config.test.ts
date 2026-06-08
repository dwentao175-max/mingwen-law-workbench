import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, maskAdminConfig, mergeApiConfig } from './config';

describe('admin config masking', () => {
  it('never returns provider API keys to the frontend', () => {
    const config = maskAdminConfig({
      text_api: { provider: 'minimax', baseURL: 'https://api.minimax.io/v1', model: 'MiniMax-M3', apiKey: 'sk-text', groupId: 'group-a' },
      vision_api: { provider: 'minimax', baseURL: 'https://api.minimax.io/v1', model: 'MiniMax-M3', apiKey: 'sk-vision' }
    });

    expect(config.text_api).toEqual({
      provider: 'minimax',
      baseURL: 'https://api.minimax.io/v1',
      model: 'MiniMax-M3',
      groupId: 'group-a',
      apiKey: '',
      apiKeyHint: '已保存 Key，末尾 xt'
    });
    expect(JSON.stringify(config)).not.toContain('sk-');
    expect(config.vision_api.apiKeyHint).toBe('已保存 Key，末尾 on');
  });

  it('preserves existing key when update omits apiKey', () => {
    const merged = mergeApiConfig(
      { provider: 'deepseek', baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: 'old-key' },
      { provider: 'openai-compatible', baseURL: 'https://example.com', model: 'law-model', apiKey: '', groupId: 'group-b' }
    );

    expect(merged).toEqual({
      provider: 'openai-compatible',
      baseURL: 'https://example.com',
      model: 'law-model',
      apiKey: 'old-key',
      groupId: 'group-b'
    });
  });

  it('defaults both API slots to MiniMax M3 with one configurable base URL shape', () => {
    expect(DEFAULT_CONFIG.text_api).toMatchObject({
      provider: 'minimax',
      baseURL: 'https://api.minimax.io/v1',
      model: 'MiniMax-M3'
    });
    expect(DEFAULT_CONFIG.vision_api).toMatchObject({
      provider: 'minimax',
      baseURL: 'https://api.minimax.io/v1',
      model: 'MiniMax-M3'
    });
  });
});
