import { useEffect, useState } from 'react';
import type { AdminConfig, ApiConfigForm } from '../lib/apiClient';
import { apiText, apiVision, getAdminConfig, updateAdminConfig } from '../lib/apiClient';

const MINIMAX_TEST_IMAGE_URL = 'https://filecdn.minimax.chat/public/fe9d04da-f60e-444d-a2e0-18ae743add33.jpeg';

export function AdminPage({ token }: { token: string }) {
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [userPassword, setUserPassword] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [textStatus, setTextStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [visionStatus, setVisionStatus] = useState<'idle' | 'success' | 'error'>('idle');

  useEffect(() => {
    let alive = true;
    void getAdminConfig(token)
      .then((data) => {
        if (alive) setConfig(withEmptyKeys(data));
      })
      .catch((error) => {
        if (alive) setMessage(error instanceof Error ? error.message : '配置读取失败');
      });
    return () => {
      alive = false;
    };
  }, [token]);

  if (!config) {
    return <section className="admin-panel">正在读取配置...</section>;
  }
  const loadedConfig = config;

  function updateApi(kind: 'text_api' | 'vision_api', patch: Partial<ApiConfigForm>) {
    setConfig((current) => (current ? { ...current, [kind]: { ...current[kind], ...patch } } : current));
  }

  async function save() {
    if (!config) return;
    setLoading(true);
    setMessage('');
    try {
      const payload = {
        userPassword: userPassword || undefined,
        adminPassword: adminPassword || undefined,
        text_api: normalizeApiPatch(config.text_api),
        vision_api: normalizeApiPatch(config.vision_api)
      };
      const next = await updateAdminConfig(token, payload);
      setConfig(withEmptyKeys(next));
      setUserPassword('');
      setAdminPassword('');
      setMessage('配置已保存');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setLoading(false);
    }
  }

  async function testText() {
    setMessage('');
    setTextStatus('idle');
    try {
      await apiText({ model: loadedConfig.text_api.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }, token);
      setMessage('文本接口连接正常');
      setTextStatus('success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '文本接口测试失败');
      setTextStatus('error');
    }
  }

  async function testVision() {
    setMessage('');
    setVisionStatus('idle');
    try {
      await apiVision({ imageUrl: MINIMAX_TEST_IMAGE_URL, prompt: '请只输出 OK。', max_completion_tokens: 20 }, token);
      setMessage('识图接口连接正常');
      setVisionStatus('success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '识图接口测试失败');
      setVisionStatus('error');
    }
  }

  return (
    <section className="admin-panel">
      <div className="admin-header">
        <div>
          <h2>管理后台</h2>
          <p>配置仅管理员可见，保存后即时生效。</p>
        </div>
      </div>

      <div className="admin-layout">
        <aside className="admin-nav">
          <a href="#admin-passwords">访问口令</a>
          <a href="#admin-apis">AI 接口</a>
          <a href="#admin-balance">余额说明</a>
        </aside>
        <div className="admin-content">
          <section className="settings-block" id="admin-passwords">
            <div className="settings-title">
              <div>
                <h3>访问口令</h3>
                <p>修改后即时生效，请妥善保存新口令。</p>
              </div>
            </div>
            <div className="admin-two-col">
              <label className="field admin-line-field">
                <span>新使用者密码</span>
                <input type="password" value={userPassword} placeholder="输入新密码" onChange={(event) => setUserPassword(event.target.value)} />
              </label>
              <label className="field admin-line-field">
                <span>新管理员密码</span>
                <input type="password" value={adminPassword} placeholder="输入新管理员密码" onChange={(event) => setAdminPassword(event.target.value)} />
              </label>
            </div>
            <button className="primary admin-pill-primary" onClick={save} disabled={loading}>
              {loading ? '保存中...' : '保存口令'}
            </button>
          </section>

          <section className="settings-block" id="admin-apis">
            <div className="settings-title">
              <div>
                <h3>AI 接口配置</h3>
                <p>密钥仅保存于中转服务，此处不显示明文。</p>
              </div>
            </div>
            <div className="admin-api-grid">
              <ApiConfigEditor
                title="文本接口"
                value={config.text_api}
                status={textStatus}
                onChange={(patch) => updateApi('text_api', patch)}
                onTest={testText}
                onSave={save}
                saving={loading}
              />
              <ApiConfigEditor
                title="识图接口"
                value={config.vision_api}
                status={visionStatus}
                onChange={(patch) => updateApi('vision_api', patch)}
                onTest={testVision}
                onSave={save}
                saving={loading}
              />
            </div>
          </section>

          <section className="settings-block" id="admin-balance">
            <div className="settings-title">
              <div>
                <h3>余额说明</h3>
                <p>余额请在 MiniMax 控制台查看；本工具不再轮询余额接口。</p>
              </div>
            </div>
            <div className="balance-box">
              <p>
                余额请在{' '}
                <a href="https://platform.minimax.io" target="_blank" rel="noreferrer">
                  MiniMax 控制台
                </a>{' '}
                查看。
              </p>
            </div>
          </section>
        </div>
      </div>
      {message && <p className="admin-message">{message}</p>}
    </section>
  );
}

function ApiConfigEditor({
  title,
  value,
  status,
  onChange,
  onTest,
  onSave,
  saving
}: {
  title: string;
  value: ApiConfigForm;
  status: 'idle' | 'success' | 'error';
  onChange: (patch: Partial<ApiConfigForm>) => void;
  onTest: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const keySuffix = keyHintSuffix(value.apiKeyHint);
  return (
    <section className="api-config-card">
      <div className="settings-title">
        <div>
          <h3>{title}</h3>
          <span className="key-status">{keySuffix ? `••••尾号 ${keySuffix}` : 'Key 状态读取中'}</span>
        </div>
        <span className={`test-status ${status}`}>{status === 'success' ? '成功' : status === 'error' ? '失败' : '未测'}</span>
      </div>
      <label className="field admin-line-field">
        <span>Provider</span>
        <select value={value.provider} onChange={(event) => onChange({ provider: event.target.value as ApiConfigForm['provider'] })}>
          <option value="minimax">MiniMax</option>
          <option value="openai-compatible">OpenAI Compatible</option>
        </select>
      </label>
      <label className="field admin-line-field">
        <span>Base URL</span>
        <input value={value.baseURL} onChange={(event) => onChange({ baseURL: event.target.value })} />
      </label>
      <label className="field admin-line-field">
        <span>Model</span>
        <input value={value.model} onChange={(event) => onChange({ model: event.target.value })} />
      </label>
      <label className="field admin-line-field">
        <span>GroupId</span>
        <input value={value.groupId ?? ''} placeholder="可留空" onChange={(event) => onChange({ groupId: event.target.value })} />
      </label>
      <label className="field admin-line-field">
        <span>API Key</span>
        <input
          type="password"
          value={value.apiKey}
          placeholder="更新密钥；留空则保留原 Key"
          onChange={(event) => onChange({ apiKey: event.target.value })}
        />
        <small className="key-hint">密钥仅保存于中转服务，此处不显示明文</small>
      </label>
      <div className="api-card-actions">
        <button className="ghost pill-ghost" onClick={onTest}>测试连接</button>
        <button className="primary admin-pill-primary" onClick={onSave} disabled={saving}>
          {saving ? '保存中...' : '保存配置'}
        </button>
      </div>
    </section>
  );
}

function withEmptyKeys(config: AdminConfig): AdminConfig {
  return {
    ...config,
    text_api: { ...config.text_api, apiKey: '' },
    vision_api: { ...config.vision_api, apiKey: '' }
  };
}

function normalizeApiPatch(config: ApiConfigForm): ApiConfigForm {
  return { ...config, apiKey: config.apiKey.trim() };
}

function keyHintSuffix(hint?: string) {
  if (!hint) return '';
  const matches = hint.match(/[A-Za-z0-9]{2,8}/g);
  return matches?.at(-1) ?? hint.slice(-4);
}
