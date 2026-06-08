import { describe, expect, it } from 'vitest';
import { hashPassword } from './auth';
import { handleRequest } from './index';
import type { Env } from './types';

describe('worker route security', () => {
  it('serves a public health response at the worker root', async () => {
    const env = await makeEnv();
    const response = await handleRequest(new Request('https://worker.example/'), env);
    const body = (await response.json()) as { ok: boolean; service: string };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, service: 'law-regulation-ai-base' });
  });

  it('rejects protected API calls without a token', async () => {
    const env = await makeEnv();
    const response = await handleRequest(jsonRequest('/api/text', {}, 'POST'), env);

    expect(response.status).toBe(401);
  });

  it('rejects wrong login password', async () => {
    const env = await makeEnv();
    const response = await handleRequest(jsonRequest('/api/login', { role: 'user', password: 'wrong' }, 'POST'), env);

    expect(response.status).toBe(401);
  });

  it('lets admin update user password so the old password stops working', async () => {
    const env = await makeEnv();
    const adminLogin = await handleRequest(jsonRequest('/api/login', { role: 'admin', password: 'admin-pass' }, 'POST'), env);
    const { token } = (await adminLogin.json()) as { token: string };

    const update = await handleRequest(
      jsonRequest('/api/admin/config', { userPassword: 'new-user-pass' }, 'POST', token),
      env
    );
    const oldLogin = await handleRequest(jsonRequest('/api/login', { role: 'user', password: 'user-pass' }, 'POST'), env);
    const newLogin = await handleRequest(jsonRequest('/api/login', { role: 'user', password: 'new-user-pass' }, 'POST'), env);

    expect(update.status).toBe(200);
    expect(oldLogin.status).toBe(401);
    expect(newLogin.status).toBe(200);
  });

  it('rejects non-whitelisted origins before routing', async () => {
    const env = await makeEnv();
    const request = jsonRequest('/api/login', { role: 'user', password: 'user-pass' }, 'POST');
    request.headers.set('Origin', 'https://evil.example');
    const response = await handleRequest(request, env);

    expect(response.status).toBe(403);
  });

  it('does not expose balance endpoints anymore', async () => {
    const env = await makeEnv();
    const login = await handleRequest(jsonRequest('/api/login', { role: 'admin', password: 'admin-pass' }, 'POST'), env);
    const { token } = (await login.json()) as { token: string };

    const balance = await handleRequest(jsonRequest('/api/balance', {}, 'GET', token), env);
    const flag = await handleRequest(jsonRequest('/api/balance/flag', {}, 'GET', token), env);

    expect(balance.status).toBe(404);
    expect(flag.status).toBe(404);
  });

  it('stores templates with author and timestamps in KV for any logged-in user to read later', async () => {
    const env = await makeEnv();
    const login = await handleRequest(jsonRequest('/api/login', { role: 'user', password: 'user-pass' }, 'POST'), env);
    const { token } = (await login.json()) as { token: string };
    const template = {
      id: 'custom',
      name: '自定义模板',
      description: '测试模板',
      scope: '法规',
      prompt: '请输出 Markdown 报告',
      author: 'Calvin',
      builtin: false
    };

    const save = await handleRequest(jsonRequest('/api/templates', template, 'POST', token), env);
    const read = await handleRequest(jsonRequest('/api/templates', {}, 'GET', token), env);
    const data = (await read.json()) as { templates: Array<{ id: string; name: string; author: string; createdAt: string; updatedAt: string }> };

    expect(save.status).toBe(200);
    const saved = data.templates.find((item) => item.id === 'custom');
    expect(saved).toMatchObject({ id: 'custom', author: 'Calvin' });
    expect(saved?.createdAt).toEqual(expect.any(String));
    expect(saved?.updatedAt).toEqual(expect.any(String));
  });

  it('requires an author when saving custom templates', async () => {
    const env = await makeEnv();
    const login = await handleRequest(jsonRequest('/api/login', { role: 'user', password: 'user-pass' }, 'POST'), env);
    const { token } = (await login.json()) as { token: string };
    const template = { id: 'custom', name: '自定义模板', description: '', scope: '', prompt: '提示词', builtin: false };

    const save = await handleRequest(jsonRequest('/api/templates', template, 'POST', token), env);

    expect(save.status).toBe(400);
  });

  it('moves deleted and edited custom templates to admin trash with usage data', async () => {
    const env = await makeEnv();
    const userLogin = await handleRequest(jsonRequest('/api/login', { role: 'user', password: 'user-pass' }, 'POST'), env);
    const adminLogin = await handleRequest(jsonRequest('/api/login', { role: 'admin', password: 'admin-pass' }, 'POST'), env);
    const { token: userToken } = (await userLogin.json()) as { token: string };
    const { token: adminToken } = (await adminLogin.json()) as { token: string };
    const template = { id: 'custom', name: '自定义模板', description: '', scope: '', prompt: '提示词 v1', author: 'Calvin', builtin: false };

    await handleRequest(jsonRequest('/api/templates', template, 'POST', userToken), env);
    const edit = await handleRequest(jsonRequest('/api/templates', { ...template, prompt: '提示词 v2', author: 'Alice' }, 'POST', userToken), env);
    const remove = await handleRequest(jsonRequest('/api/templates/custom', { author: 'Bob' }, 'DELETE', userToken), env);
    const read = await handleRequest(jsonRequest('/api/templates', {}, 'GET', userToken), env);
    const data = (await read.json()) as { templates: Array<{ id: string }> };
    const trash = await handleRequest(jsonRequest('/api/templates/trash', {}, 'GET', adminToken), env);
    const trashData = (await trash.json()) as {
      items: Array<{ id: string; template: { id: string; prompt: string; author: string }; reason: string; removedBy: string; removedAt: string }>;
      usage: { bytes: number; maxBytes: number; percent: number; count: number };
    };

    expect(edit.status).toBe(200);
    expect(remove.status).toBe(200);
    expect(data.templates.some((item) => item.id === 'custom')).toBe(false);
    expect(trashData.items).toHaveLength(2);
    expect(trashData.items.map((item) => item.reason)).toEqual(['deleted', 'edited']);
    expect(trashData.items[0]).toMatchObject({ removedBy: 'Bob', reason: 'deleted' });
    expect(trashData.items[1]).toMatchObject({ removedBy: 'Alice', reason: 'edited', template: { prompt: '提示词 v1', author: 'Calvin' } });
    expect(trashData.usage.count).toBe(2);
    expect(trashData.usage.maxBytes).toBe(1_048_576);
    expect(trashData.usage.percent).toBeGreaterThan(0);
  });

  it('lets only admins restore, delete, and clear template trash', async () => {
    const env = await makeEnv();
    const userLogin = await handleRequest(jsonRequest('/api/login', { role: 'user', password: 'user-pass' }, 'POST'), env);
    const adminLogin = await handleRequest(jsonRequest('/api/login', { role: 'admin', password: 'admin-pass' }, 'POST'), env);
    const { token: userToken } = (await userLogin.json()) as { token: string };
    const { token: adminToken } = (await adminLogin.json()) as { token: string };
    const template = { id: 'custom', name: '自定义模板', description: '', scope: '', prompt: '提示词', author: 'Calvin', builtin: false };

    await handleRequest(jsonRequest('/api/templates', template, 'POST', userToken), env);
    await handleRequest(jsonRequest('/api/templates/custom', { author: 'Calvin' }, 'DELETE', userToken), env);
    const userTrash = await handleRequest(jsonRequest('/api/templates/trash', {}, 'GET', userToken), env);
    const adminTrash = await handleRequest(jsonRequest('/api/templates/trash', {}, 'GET', adminToken), env);
    const { items } = (await adminTrash.json()) as { items: Array<{ id: string }> };
    const restore = await handleRequest(jsonRequest('/api/templates/trash/restore', { id: items[0].id }, 'POST', adminToken), env);
    const read = await handleRequest(jsonRequest('/api/templates', {}, 'GET', userToken), env);
    const restored = (await read.json()) as { templates: Array<{ id: string }> };
    await handleRequest(jsonRequest('/api/templates/custom', { author: 'Calvin' }, 'DELETE', userToken), env);
    const trashAfterSecondDelete = await handleRequest(jsonRequest('/api/templates/trash', {}, 'GET', adminToken), env);
    const secondTrash = (await trashAfterSecondDelete.json()) as { items: Array<{ id: string }> };
    const purgeOne = await handleRequest(jsonRequest(`/api/templates/trash/${secondTrash.items[0].id}`, {}, 'DELETE', adminToken), env);
    const clear = await handleRequest(jsonRequest('/api/templates/trash', {}, 'DELETE', adminToken), env);

    expect(userTrash.status).toBe(403);
    expect(restore.status).toBe(200);
    expect(restored.templates.some((item) => item.id === 'custom')).toBe(true);
    expect(purgeOne.status).toBe(200);
    expect(clear.status).toBe(200);
  });

  it('rejects builtin template saves and never trashes builtin deletes', async () => {
    const env = await makeEnv();
    const login = await handleRequest(jsonRequest('/api/login', { role: 'admin', password: 'admin-pass' }, 'POST'), env);
    const { token } = (await login.json()) as { token: string };
    const template = { id: 'builtin', name: '内置模板', description: '', scope: '', prompt: '提示词', author: '系统', builtin: true };

    const builtinSave = await handleRequest(jsonRequest('/api/templates', template, 'POST', token), env);
    const builtinDelete = await handleRequest(jsonRequest('/api/templates/builtin-general-report', { author: 'Calvin' }, 'DELETE', token), env);

    expect(builtinSave.status).toBe(400);
    expect(builtinDelete.status).toBe(400);
  });
});

async function makeEnv(): Promise<Env> {
  const kv = new MemoryKV();
  await kv.put('admin_pw_hash', await hashPassword('admin-pass'));
  await kv.put('user_pw_hash', await hashPassword('user-pass'));
  await kv.put(
    'text_api',
    JSON.stringify({ provider: 'openai-compatible', baseURL: 'https://provider.example', model: 'model', apiKey: 'sk-text' })
  );
  await kv.put(
    'vision_api',
    JSON.stringify({ provider: 'openai-compatible', baseURL: 'https://provider.example', model: 'model', apiKey: 'sk-vision' })
  );
  return {
    CONFIG_KV: kv as unknown as KVNamespace,
    TOKEN_SECRET: 'route-test-secret',
    ALLOWED_ORIGINS: 'https://example.github.io',
    TOKEN_TTL_SECONDS: '43200'
  };
}

function jsonRequest(path: string, body: unknown, method: string, token?: string): Request {
  const headers = new Headers({ 'Content-Type': 'application/json', Origin: 'https://example.github.io' });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return new Request(`https://worker.example${path}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(body)
  });
}

class MemoryKV {
  private store = new Map<string, string>();

  async get<T = string>(key: string, type?: 'json'): Promise<T | string | null> {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return type === 'json' ? (JSON.parse(value) as T) : value;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}
