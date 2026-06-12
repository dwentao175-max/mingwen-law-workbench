import type { Template, TemplateTrashItem, TemplateTrashUsage } from '../types';

export type Role = 'admin' | 'user';

export type AuthSession = {
  token: string;
  role: Role;
  exp: number;
};

export type ApiConfigForm = {
  provider: 'deepseek' | 'minimax' | 'openai-compatible';
  baseURL: string;
  model: string;
  apiKey: string;
  apiKeyHint?: string;
  groupId?: string;
};

export type AdminConfig = {
  text_api: ApiConfigForm;
  vision_api: ApiConfigForm;
};

const SESSION_KEY = 'lawWorkbench.authSession';
const WORKER_URL = (import.meta.env.VITE_WORKER_URL ?? '').replace(/\/+$/, '');

export function getStoredSession(): AuthSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed.token || parsed.exp <= Math.floor(Date.now() / 1000)) {
      clearStoredSession();
      return null;
    }
    return parsed;
  } catch {
    clearStoredSession();
    return null;
  }
}

export function storeSession(session: AuthSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearStoredSession() {
  localStorage.removeItem(SESSION_KEY);
}

export async function login(role: Role, password: string): Promise<AuthSession> {
  const session = await request<AuthSession>('/api/login', {
    method: 'POST',
    body: { role, password }
  });
  storeSession(session);
  return session;
}

export async function apiText(body: unknown, token: string): Promise<unknown> {
  return request('/api/text', { method: 'POST', token, body });
}

export async function apiVision(body: unknown, token: string): Promise<{ text?: string; raw?: unknown }> {
  return request('/api/vision', { method: 'POST', token, body });
}

export async function getAdminConfig(token: string): Promise<AdminConfig> {
  return request('/api/admin/config', { token });
}

export async function updateAdminConfig(token: string, body: unknown): Promise<AdminConfig> {
  return request('/api/admin/config', { method: 'POST', token, body });
}

export async function getTemplates(token: string): Promise<{ templates: Template[] }> {
  return request('/api/templates', { token });
}

export async function saveTemplate(token: string, template: Template): Promise<{ templates: Template[] }> {
  return request('/api/templates', { method: 'POST', token, body: template });
}

export async function deleteTemplate(token: string, id: string, author: string): Promise<{ templates: Template[] }> {
  return request(`/api/templates/${encodeURIComponent(id)}`, { method: 'DELETE', token, body: { author } });
}

export async function getTemplateTrash(token: string): Promise<{ items: TemplateTrashItem[]; usage: TemplateTrashUsage }> {
  return request('/api/templates/trash', { token });
}

export async function restoreTemplateTrash(token: string, id: string): Promise<{ templates: Template[]; items: TemplateTrashItem[]; usage: TemplateTrashUsage }> {
  return request('/api/templates/trash/restore', { method: 'POST', token, body: { id } });
}

export async function purgeTemplateTrash(token: string, id: string): Promise<{ items: TemplateTrashItem[]; usage: TemplateTrashUsage }> {
  return request(`/api/templates/trash/${encodeURIComponent(id)}`, { method: 'DELETE', token });
}

export async function clearTemplateTrash(token: string): Promise<{ items: TemplateTrashItem[]; usage: TemplateTrashUsage }> {
  return request('/api/templates/trash', { method: 'DELETE', token });
}

async function request<T>(path: string, options: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${WORKER_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  if (response.status === 401) clearStoredSession();
  const text = await response.text();
  const data = parseResponseText(text);
  if (!response.ok) throw new Error(responseErrorMessage(data, response.status));
  return data as T;
}

function parseResponseText(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function responseErrorMessage(data: unknown, status: number): string {
  const text = typeof data === 'string' ? data : '';
  if (status === 524 || /error code:\s*524/i.test(text)) {
    return 'AI 服务响应超时，请稍后重试；如果文档较长，请尝试缩短文档或分段解读。';
  }
  if (data && typeof data === 'object' && 'error' in data) return String((data as { error?: unknown }).error ?? `请求失败：HTTP ${status}`);
  return text || `请求失败：HTTP ${status}`;
}
