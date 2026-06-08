import { describe, expect, it, vi } from 'vitest';
import { MiniMaxAdapter } from './providers';

describe('MiniMaxAdapter', () => {
  it('uses MiniMax OpenAI-compatible chat completions and injects configured model', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [] })));
    const adapter = new MiniMaxAdapter();

    await adapter.chat(
      { provider: 'minimax', baseURL: 'https://api.minimax.io/v1', model: 'MiniMax-M3', apiKey: 'sk-test' },
      { messages: [{ role: 'user', content: 'hello' }] }
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.minimax.io/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"model":"MiniMax-M3"')
      })
    );
    fetchMock.mockRestore();
  });

  it('lets configured model override any model sent by the client', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [] })));
    const adapter = new MiniMaxAdapter();

    await adapter.chat(
      { provider: 'minimax', baseURL: 'https://api.minimax.io/v1', model: 'MiniMax-M3', apiKey: 'sk-test' },
      { model: 'client-selected-model', messages: [{ role: 'user', content: 'hello' }] }
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body)).model).toBe('MiniMax-M3');
    fetchMock.mockRestore();
  });

  it('normalizes internal OCR requests to image_url content parts', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '识别文本' } }] })));
    const adapter = new MiniMaxAdapter();
    const response = await adapter.vision(
      { provider: 'minimax', baseURL: 'https://api.minimax.io/v1', model: 'MiniMax-M3', apiKey: 'sk-test', groupId: 'g1' },
      { image: 'data:image/png;base64,abc' }
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'MiniMax-M3',
      thinking: { type: 'adaptive' },
      messages: [{ content: [{ type: 'text' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }] }]
    });
    expect((init?.headers as Record<string, string>).GroupId).toBe('g1');
    await expect(response.json()).resolves.toMatchObject({ text: '识别文本' });
    fetchMock.mockRestore();
  });

  it('surfaces provider error details for failed internal OCR requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ base_resp: { status_msg: 'image_url invalid' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const adapter = new MiniMaxAdapter();
    const response = await adapter.vision(
      { provider: 'minimax', baseURL: 'https://api.minimaxi.com/v1/chat/completions', model: 'MiniMax-M3', apiKey: 'sk-test' },
      { imageUrl: 'https://example.com/image.jpeg' }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'image_url invalid' });
    fetchMock.mockRestore();
  });
});
