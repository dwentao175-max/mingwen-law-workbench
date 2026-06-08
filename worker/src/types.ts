export type Role = 'admin' | 'user';

export type ApiProvider = 'deepseek' | 'minimax' | 'openai-compatible';

export type ApiConfig = {
  provider: ApiProvider;
  baseURL: string;
  model: string;
  apiKey: string;
  groupId?: string;
};

export type AppConfig = {
  text_api: ApiConfig;
  vision_api: ApiConfig;
};

export type PublicApiConfig = Omit<ApiConfig, 'apiKey'> & { apiKey: ''; apiKeyHint: string };

export type PublicAppConfig = {
  text_api: PublicApiConfig;
  vision_api: PublicApiConfig;
};

export type Env = {
  CONFIG_KV: KVNamespace;
  TOKEN_SECRET: string;
  ALLOWED_ORIGINS: string;
  TOKEN_TTL_SECONDS?: string;
};

export type TokenPayload = {
  role: Role;
  exp: number;
};

export type Template = {
  id: string;
  name: string;
  description: string;
  scope: string;
  prompt: string;
  builtin: boolean;
  author: string;
  createdAt: string;
  updatedAt: string;
};

export type TemplateTrashItem = {
  id: string;
  template: Template;
  removedAt: string;
  removedBy: string;
  reason: 'deleted' | 'edited';
};
