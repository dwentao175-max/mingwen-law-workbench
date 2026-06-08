import { type FormEvent, useEffect, useState } from 'react';
import type { AuthSession, Role } from '../lib/apiClient';
import { login } from '../lib/apiClient';
import { BrandMark } from '../components/BrandMark';

const HOME_VIDEO_SRC = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260530_042513_df96a13b-6155-4f6e-8b93-c9dee66fba08.mp4';

export function LoginPage({ onLogin }: { onLogin: (session: AuthSession) => void }) {
  const [role, setRole] = useState<Role>('user');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 80);
    return () => window.clearTimeout(timer);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      onLogin(await login(role, password));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '口令错误，请重新输入。');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-white text-black">
      <video className="fixed inset-0 z-0 h-full w-full object-cover object-[70%_center] opacity-25 grayscale" src={HOME_VIDEO_SRC} muted playsInline preload="auto" />
      <div className="fixed inset-0 z-0 bg-white/55 backdrop-blur-[2px]" />
      <div className="relative z-[1] min-h-screen">
        <header className="absolute left-5 top-5 sm:left-8 sm:top-5">
          <BrandMark size="login" />
        </header>
        <section className="grid min-h-screen w-full place-items-center px-5 py-16 sm:px-8">
          <div className={`w-full max-w-sm transition-all duration-400 ease-out ${ready ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}`}>
            <p className="mb-8 text-[18px] leading-[1.35] text-black sm:text-[20px]">请输入访问口令</p>
            <form className="grid gap-7" onSubmit={submit}>
              <label className="block">
                <span className="sr-only">{role === 'admin' ? '管理员口令' : '访问口令'}</span>
                <input
                  className="w-full border-0 border-b border-black/30 bg-transparent px-0 py-3 text-[22px] text-black outline-none transition-colors duration-200 placeholder:text-black/35 focus:border-black"
                  type="password"
                  value={password}
                  autoFocus
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={role === 'admin' ? '管理员口令' : '访问口令'}
                />
              </label>
              <div className="flex items-center justify-between gap-4">
                <button className="rounded-full border border-black bg-black px-6 py-[0.5em] text-[17px] text-white outline-none transition-opacity duration-200 hover:opacity-80 focus:outline-none disabled:opacity-35" disabled={!password || loading}>
                  {loading ? '验证中' : '进入'}
                </button>
              </div>
            </form>
            {message && <p className="mt-5 text-[13px] leading-relaxed text-red-600">{message}</p>}
            <button
              type="button"
              className="mt-9 border-0 bg-transparent p-0 text-[14px] text-black/70 outline-none transition-opacity duration-200 hover:border-0 hover:opacity-60 focus:outline-none"
              onClick={() => {
                setRole((current) => (current === 'admin' ? 'user' : 'admin'));
                setPassword('');
                setMessage('');
              }}
            >
              {role === 'admin' ? '使用者登录' : '管理员登录'}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
