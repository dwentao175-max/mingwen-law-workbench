import type { ApiConfig, AppConfig, Env, PublicAppConfig } from './types';
import { hashPassword } from './auth';

export const DEFAULT_CONFIG: AppConfig = {
  text_api: {
    provider: 'minimax',
    baseURL: 'https://api.minimax.io/v1',
    model: 'MiniMax-M3',
    apiKey: ''
  },
  vision_api: {
    provider: 'minimax',
    baseURL: 'https://api.minimax.io/v1',
    model: 'MiniMax-M3',
    apiKey: ''
  }
};

export async function readConfig(env: Env): Promise<AppConfig> {
  const [textApi, visionApi] = await Promise.all([
    env.CONFIG_KV.get<ApiConfig>('text_api', 'json'),
    env.CONFIG_KV.get<ApiConfig>('vision_api', 'json')
  ]);

  return {
    text_api: { ...DEFAULT_CONFIG.text_api, ...textApi },
    vision_api: { ...DEFAULT_CONFIG.vision_api, ...visionApi }
  };
}

export async function updateConfig(env: Env, current: AppConfig, patch: AdminConfigPatch): Promise<AppConfig> {
  const next: AppConfig = {
    text_api: patch.text_api ? mergeApiConfig(current.text_api, patch.text_api) : current.text_api,
    vision_api: patch.vision_api ? mergeApiConfig(current.vision_api, patch.vision_api) : current.vision_api
  };

  const writes: Promise<unknown>[] = [
    env.CONFIG_KV.put('text_api', JSON.stringify(next.text_api)),
    env.CONFIG_KV.put('vision_api', JSON.stringify(next.vision_api))
  ];
  if (patch.userPassword) writes.push(env.CONFIG_KV.put('user_pw_hash', await hashPassword(patch.userPassword)));
  if (patch.adminPassword) writes.push(env.CONFIG_KV.put('admin_pw_hash', await hashPassword(patch.adminPassword)));
  await Promise.all(writes);
  return next;
}

export function mergeApiConfig(current: ApiConfig, patch: Partial<ApiConfig>): ApiConfig {
  return {
    provider: patch.provider ?? current.provider,
    baseURL: patch.baseURL ?? current.baseURL,
    model: patch.model ?? current.model,
    apiKey: patch.apiKey && patch.apiKey.trim() ? patch.apiKey.trim() : current.apiKey,
    groupId: patch.groupId !== undefined ? patch.groupId.trim() || undefined : current.groupId
  };
}

export function maskAdminConfig(config: AppConfig): PublicAppConfig {
  return {
    text_api: maskApiConfig(config.text_api),
    vision_api: maskApiConfig(config.vision_api)
  };
}

function maskApiConfig(config: ApiConfig) {
  return {
    provider: config.provider,
    baseURL: config.baseURL,
    model: config.model,
    groupId: config.groupId ?? '',
    apiKey: '' as const,
    apiKeyHint: config.apiKey ? `已保存 Key，末尾 ${config.apiKey.slice(-2)}` : '未设置 Key'
  };
}

export type AdminConfigPatch = {
  userPassword?: string;
  adminPassword?: string;
  text_api?: Partial<ApiConfig>;
  vision_api?: Partial<ApiConfig>;
};
