import { tokenFromRequest, signToken, verifyPassword, verifyToken } from './auth';
import { maskAdminConfig, readConfig, updateConfig } from './config';
import { assertAllowedOrigin, corsHeaders } from './cors';
import { adapterFor } from './providers';
import type { Env, Role, Template, TemplateTrashItem, TokenPayload } from './types';

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  }
};

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/') {
    return json({
      ok: true,
      service: 'law-regulation-ai-base',
      message: 'Worker 后端已启动。请从前端页面访问工作台，本地址仅用于 API 中转。'
    });
  }

  const origin = assertAllowedOrigin(request.headers.get('Origin'), env.ALLOWED_ORIGINS);
  if (!origin) return json({ error: 'Forbidden origin' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

  try {
    const response = await route(request, env, url);
    return withCors(response, origin);
  } catch (error) {
    if (!(error instanceof HttpError)) {
      console.error('Worker request failed', error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error);
    }
    const message = error instanceof HttpError ? error.message : 'Internal server error';
    const status = error instanceof HttpError ? error.status : 500;
    return withCors(json({ error: message }, status), origin);
  }
}

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === 'POST' && url.pathname === '/api/login') return login(request, env);
  if (request.method === 'POST' && url.pathname === '/api/text') return proxyText(request, env);
  if (request.method === 'POST' && url.pathname === '/api/vision') return proxyVision(request, env);
  if (request.method === 'GET' && url.pathname === '/api/admin/config') return getAdminConfig(request, env);
  if (request.method === 'POST' && url.pathname === '/api/admin/config') return postAdminConfig(request, env);
  if (request.method === 'GET' && url.pathname === '/api/templates') return getTemplates(request, env);
  if (request.method === 'POST' && url.pathname === '/api/templates') return postTemplate(request, env);
  if (request.method === 'GET' && url.pathname === '/api/templates/trash') return getTemplateTrash(request, env);
  if (request.method === 'POST' && url.pathname === '/api/templates/trash/restore') return restoreTemplateTrash(request, env);
  if (request.method === 'DELETE' && url.pathname === '/api/templates/trash') return clearTemplateTrash(request, env);
  if (request.method === 'DELETE' && url.pathname.startsWith('/api/templates/trash/')) return purgeTemplateTrashItem(request, env, url);
  if (request.method === 'DELETE' && url.pathname.startsWith('/api/templates/')) return deleteTemplate(request, env, url);
  return json({ error: 'Not found' }, 404);
}

async function login(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { role?: Role; password?: string };
  if (body.role !== 'admin' && body.role !== 'user') throw new HttpError(400, 'Invalid role');
  const hash = await env.CONFIG_KV.get(`${body.role}_pw_hash`);
  const ok = await verifyPassword(body.password ?? '', hash);
  if (!ok) throw new HttpError(401, 'Invalid password');
  const ttl = Number(env.TOKEN_TTL_SECONDS ?? 43_200);
  const payload: TokenPayload = { role: body.role, exp: Math.floor(Date.now() / 1000) + ttl };
  return json({ token: await signToken(payload, env.TOKEN_SECRET), role: body.role, exp: payload.exp });
}

async function proxyText(request: Request, env: Env): Promise<Response> {
  await requireRole(request, env, ['admin', 'user']);
  const config = await readConfig(env);
  return adapterFor(config.text_api.provider).chat(config.text_api, await request.json());
}

async function proxyVision(request: Request, env: Env): Promise<Response> {
  await requireRole(request, env, ['admin', 'user']);
  const config = await readConfig(env);
  return adapterFor(config.vision_api.provider).vision(config.vision_api, await request.json());
}

async function getAdminConfig(request: Request, env: Env): Promise<Response> {
  await requireRole(request, env, ['admin']);
  return json(maskAdminConfig(await readConfig(env)));
}

async function postAdminConfig(request: Request, env: Env): Promise<Response> {
  await requireRole(request, env, ['admin']);
  const current = await readConfig(env);
  const next = await updateConfig(env, current, await request.json());
  return json(maskAdminConfig(next));
}

async function getTemplates(request: Request, env: Env): Promise<Response> {
  await requireRole(request, env, ['admin', 'user']);
  return json({ templates: await readTemplates(env) });
}

async function postTemplate(request: Request, env: Env): Promise<Response> {
  await requireRole(request, env, ['admin', 'user']);
  const body = await request.json();
  if ((body as Template)?.builtin) throw new HttpError(400, 'Built-in templates cannot be overwritten');
  const templates = await readTemplates(env);
  const current = templates.find((item) => item.id === (body as Template)?.id);
  const template = validateTemplate(body, current);
  const trash = current && !current.builtin ? await readTemplateTrash(env) : [];
  if (current && !current.builtin) {
    trash.unshift(trashItem(current, template.author, 'edited'));
  }
  const next = [...templates.filter((item) => item.id !== template.id), template];
  await Promise.all([
    env.CONFIG_KV.put('templates', JSON.stringify(next)),
    current && !current.builtin ? writeTemplateTrash(env, trash) : Promise.resolve()
  ]);
  return json({ templates: next });
}

async function deleteTemplate(request: Request, env: Env, url: URL): Promise<Response> {
  await requireRole(request, env, ['admin', 'user']);
  const id = decodeURIComponent(url.pathname.replace('/api/templates/', '')).trim();
  if (!id) throw new HttpError(400, 'Invalid template id');
  if (isBuiltinTemplateId(id)) throw new HttpError(400, 'Built-in templates cannot be deleted');
  const body = await optionalJson(request);
  const removedBy = requiredAuthor(body);
  const templates = await readTemplates(env);
  const target = templates.find((item) => item.id === id);
  if (target?.builtin) throw new HttpError(400, 'Built-in templates cannot be deleted');
  if (!target) throw new HttpError(404, 'Template not found');
  const next = templates.filter((item) => item.id !== id);
  const trash = await readTemplateTrash(env);
  trash.unshift(trashItem(target, removedBy, 'deleted'));
  await Promise.all([env.CONFIG_KV.put('templates', JSON.stringify(next)), writeTemplateTrash(env, trash)]);
  return json({ templates: next });
}

async function getTemplateTrash(request: Request, env: Env): Promise<Response> {
  await requireRole(request, env, ['admin']);
  const items = await readTemplateTrash(env);
  return json({ items, usage: trashUsage(items) });
}

async function restoreTemplateTrash(request: Request, env: Env): Promise<Response> {
  await requireRole(request, env, ['admin']);
  const body = (await request.json()) as { id?: string };
  if (!body.id) throw new HttpError(400, 'Invalid trash id');
  const [templates, trash] = await Promise.all([readTemplates(env), readTemplateTrash(env)]);
  const item = trash.find((entry) => entry.id === body.id);
  if (!item) throw new HttpError(404, 'Trash item not found');
  const nextTemplates = [...templates.filter((template) => template.id !== item.template.id), item.template];
  const nextTrash = trash.filter((entry) => entry.id !== body.id);
  await Promise.all([
    env.CONFIG_KV.put('templates', JSON.stringify(nextTemplates)),
    writeTemplateTrash(env, nextTrash)
  ]);
  return json({ templates: nextTemplates, items: nextTrash, usage: trashUsage(nextTrash) });
}

async function purgeTemplateTrashItem(request: Request, env: Env, url: URL): Promise<Response> {
  await requireRole(request, env, ['admin']);
  const id = decodeURIComponent(url.pathname.replace('/api/templates/trash/', '')).trim();
  if (!id) throw new HttpError(400, 'Invalid trash id');
  const trash = await readTemplateTrash(env);
  const nextTrash = trash.filter((entry) => entry.id !== id);
  await writeTemplateTrash(env, nextTrash);
  return json({ items: nextTrash, usage: trashUsage(nextTrash) });
}

async function clearTemplateTrash(request: Request, env: Env): Promise<Response> {
  await requireRole(request, env, ['admin']);
  await writeTemplateTrash(env, []);
  return json({ items: [], usage: trashUsage([]) });
}

async function requireRole(request: Request, env: Env, roles: Role[]): Promise<TokenPayload> {
  const payload = await verifyToken(tokenFromRequest(request), env.TOKEN_SECRET);
  if (!payload) throw new HttpError(401, 'Unauthorized');
  if (!roles.includes(payload.role)) throw new HttpError(403, 'Forbidden');
  return payload;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function withCors(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

async function readTemplates(env: Env): Promise<Template[]> {
  const raw = ((await env.CONFIG_KV.get<Template[]>('templates', 'json')) ?? []) as Template[];
  return raw.map(normalizeStoredTemplate).filter((item): item is Template => Boolean(item));
}

async function readTemplateTrash(env: Env): Promise<TemplateTrashItem[]> {
  const raw = ((await env.CONFIG_KV.get<TemplateTrashItem[]>('templates_trash', 'json')) ?? []) as TemplateTrashItem[];
  return raw.filter((item) => item?.id && item.template);
}

async function writeTemplateTrash(env: Env, items: TemplateTrashItem[]): Promise<void> {
  await env.CONFIG_KV.put('templates_trash', JSON.stringify(items));
}

function validateTemplate(value: unknown, current?: Template): Template {
  if (!value || typeof value !== 'object') throw new HttpError(400, 'Invalid template');
  const template = value as Template;
  if (!template.id || !template.name || !template.prompt) throw new HttpError(400, 'Invalid template');
  const author = requiredAuthor(template);
  const now = new Date().toISOString();
  return {
    id: String(template.id),
    name: String(template.name),
    description: String(template.description ?? ''),
    scope: String(template.scope ?? ''),
    prompt: String(template.prompt),
    builtin: false,
    author,
    createdAt: current?.createdAt ?? template.createdAt ?? now,
    updatedAt: now
  };
}

function normalizeStoredTemplate(value: unknown): Template | null {
  if (!value || typeof value !== 'object') return null;
  const template = value as Partial<Template>;
  if (!template.id || !template.name || !template.prompt) return null;
  const now = new Date().toISOString();
  return {
    id: String(template.id),
    name: String(template.name),
    description: String(template.description ?? ''),
    scope: String(template.scope ?? ''),
    prompt: String(template.prompt),
    builtin: Boolean(template.builtin),
    author: String(template.author ?? '历史模板'),
    createdAt: String(template.createdAt ?? now),
    updatedAt: String(template.updatedAt ?? template.createdAt ?? now)
  };
}

function requiredAuthor(value: unknown): string {
  const author = value && typeof value === 'object' ? String((value as { author?: unknown }).author ?? '').trim() : '';
  if (!author) throw new HttpError(400, 'Template author is required');
  return author;
}

async function optionalJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function trashItem(template: Template, removedBy: string, reason: TemplateTrashItem['reason']): TemplateTrashItem {
  return {
    id: crypto.randomUUID(),
    template,
    removedAt: new Date().toISOString(),
    removedBy,
    reason
  };
}

function trashUsage(items: TemplateTrashItem[]) {
  const bytes = new TextEncoder().encode(JSON.stringify(items)).length;
  const maxBytes = 1_048_576;
  return {
    bytes,
    maxBytes,
    count: items.length,
    percent: Math.round((bytes / maxBytes) * 10_000) / 100
  };
}

function isBuiltinTemplateId(id: string): boolean {
  return id === 'builtin-general-report' || id.startsWith('builtin-');
}
