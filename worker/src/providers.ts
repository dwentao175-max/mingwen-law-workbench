import type { ApiConfig } from './types';

export interface ProviderAdapter {
  chat(config: ApiConfig, body: unknown): Promise<Response>;
  vision(config: ApiConfig, body: unknown): Promise<Response>;
}

export function adapterFor(provider: string): ProviderAdapter {
  if (provider === 'deepseek') return new DeepSeekAdapter();
  if (provider === 'minimax') return new MiniMaxAdapter();
  return new OpenAICompatibleAdapter();
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  async chat(config: ApiConfig, body: unknown): Promise<Response> {
    return providerFetch(chatCompletionsUrl(config.baseURL), config, body);
  }

  async vision(config: ApiConfig, body: unknown): Promise<Response> {
    return providerFetch(chatCompletionsUrl(config.baseURL), config, normalizeVisionBody(config, body));
  }

}

export class DeepSeekAdapter extends OpenAICompatibleAdapter {
  async chat(config: ApiConfig, body: unknown): Promise<Response> {
    return providerFetch(`${trimSlash(config.baseURL)}/chat/completions`, config, body);
  }

}

export class MiniMaxAdapter extends OpenAICompatibleAdapter {
  async chat(config: ApiConfig, body: unknown): Promise<Response> {
    return providerFetch(chatCompletionsUrl(config.baseURL), config, withModel(config, body));
  }

  async vision(config: ApiConfig, body: unknown): Promise<Response> {
    const response = await providerFetch(chatCompletionsUrl(config.baseURL), config, normalizeVisionBody(config, body));
    if (!isInternalOcrRequest(body)) return response;

    const data = await safeJson(response);
    if (!response.ok) {
      return jsonResponse({ error: providerErrorMessage(data, response.status), raw: data }, response.status);
    }
    const content = data.choices?.[0]?.message?.content ?? '';
    return jsonResponse({ text: stripThinkBlock(content), raw: data }, response.status);
  }

}

function normalizeVisionBody(config: ApiConfig, body: unknown): unknown {
  if (!isInternalOcrRequest(body)) return body;
  const imageUrl = body.imageUrl ?? body.image;
  return {
    model: config.model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              body.prompt ??
              '请对这页法规 PDF 扫描图片进行 OCR，只输出可见文字，保留自然段和条文换行，不要解释。'
          },
          {
            type: 'image_url',
            image_url: { url: imageUrl }
          }
        ]
      }
    ],
    thinking: { type: 'adaptive' },
    max_completion_tokens: body.max_completion_tokens ?? 4096
  };
}

async function safeJson(response: Response): Promise<OpenAIChatResponse & Record<string, unknown>> {
  try {
    return (await response.json()) as OpenAIChatResponse & Record<string, unknown>;
  } catch {
    return {};
  }
}

function providerErrorMessage(data: Record<string, unknown>, status: number): string {
  const direct = typeof data.error === 'string' ? data.error : undefined;
  const nestedError =
    data.error && typeof data.error === 'object' && 'message' in data.error
      ? String((data.error as { message?: unknown }).message)
      : undefined;
  const baseResp =
    data.base_resp && typeof data.base_resp === 'object' && 'status_msg' in data.base_resp
      ? String((data.base_resp as { status_msg?: unknown }).status_msg)
      : undefined;
  return direct || nestedError || baseResp || `Provider request failed: HTTP ${status}`;
}

function withModel(config: ApiConfig, body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  return { ...(body as Record<string, unknown>), model: config.model };
}

function isInternalOcrRequest(body: unknown): body is {
  image?: string;
  imageUrl?: string;
  prompt?: string;
  max_completion_tokens?: number;
} {
  if (!body || typeof body !== 'object') return false;
  const value = body as Record<string, unknown>;
  return typeof value.image === 'string' || typeof value.imageUrl === 'string';
}

async function providerFetch(url: string, config: ApiConfig, body: unknown): Promise<Response> {
  if (!config.apiKey) return jsonResponse({ error: 'Provider API key is not configured' }, 500);
  return fetch(withGroupId(url, config), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      ...(config.groupId ? { GroupId: config.groupId } : {})
    },
    body: JSON.stringify(body)
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function chatCompletionsUrl(baseURL: string): string {
  const trimmed = trimSlash(baseURL);
  if (/\/chat\/completions$/.test(trimmed) || /\/text\/chatcompletion_v2$/.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

function withGroupId(url: string, config: ApiConfig): string {
  if (!config.groupId) return url;
  if (!/api\.minimax\.chat|GroupId/i.test(url)) return url;
  const parsed = new URL(url);
  if (!parsed.searchParams.has('GroupId')) parsed.searchParams.set('GroupId', config.groupId);
  return parsed.toString();
}

function stripThinkBlock(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

type OpenAIChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};
