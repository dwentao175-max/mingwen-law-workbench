import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTypewriter } from '../hooks/useTypewriter';
import { Nav } from './Nav';

const VIDEO_SRC = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260530_042513_df96a13b-6155-4f6e-8b93-c9dee66fba08.mp4';

type HomePageProps = {
  onNavigate: (target: 'compare' | 'interpret') => void;
  accountControl: ReactNode;
};

export function HomePage({ onNavigate, accountControl }: HomePageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const targetTimeRef = useRef(0);
  const prevXRef = useRef<number | null>(null);
  const seekingRef = useRef(false);
  const [labelReady, setLabelReady] = useState(false);
  const [showChoice, setShowChoice] = useState(false);
  const { text, done } = useTypewriter('两份文稿之间改了什么，一部法规到底在说什么——交给我，逐字为你看明白。', 38, 600);

  useEffect(() => {
    const timer = window.setTimeout(() => setLabelReady(true), 80);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const clamp = (value: number) => Math.max(0, Math.min(video.duration || 0, value));
    const seek = () => {
      if (!video.duration || seekingRef.current) return;
      seekingRef.current = true;
      video.currentTime = clamp(targetTimeRef.current);
    };
    const onMouseMove = (event: MouseEvent) => {
      const previous = prevXRef.current;
      prevXRef.current = event.clientX;
      if (previous == null || !video.duration) return;
      const delta = event.clientX - previous;
      targetTimeRef.current = clamp(targetTimeRef.current + (delta / window.innerWidth) * 0.8 * video.duration);
      seek();
    };
    const onSeeked = () => {
      seekingRef.current = false;
      if (Math.abs(video.currentTime - targetTimeRef.current) > 0.03) seek();
    };
    const onLoadedMetadata = () => {
      targetTimeRef.current = Math.min(video.duration || 0, 0.01);
    };

    window.addEventListener('mousemove', onMouseMove);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, []);

  return (
    <main className="min-h-screen bg-white text-black">
      <video ref={videoRef} className="fixed inset-0 z-0 h-full w-full object-cover object-[70%_center]" src={VIDEO_SRC} muted playsInline preload="auto" />
      <Nav accountControl={accountControl} />
      {!showChoice ? (
        <section className="relative z-[1] flex h-screen max-w-xl flex-col justify-end px-5 pb-12 sm:px-8 md:justify-center md:px-10 md:pb-0">
          <div className="hero-copy-panel">
            <div className={`pointer-events-none mb-5 select-none text-hero-label font-normal leading-[1.3] text-black transition-all duration-[800ms] ease-out sm:mb-6 ${labelReady ? 'opacity-100 blur-0' : 'opacity-0 blur-[8px]'}`}>
              你好，我是明文。<br />
              为法律文本而生的阅读者。
            </div>
            <p className="min-h-[88px] max-w-[20em] text-hero-copy leading-[1.38] text-black">
              {text}
              {!done && <span className="ml-[3px] inline-block h-[1.1em] w-[2px] translate-y-[0.18em] animate-[blink_1s_step-end_infinite] bg-black" />}
            </p>
            <button className="hero-start-pill" onClick={() => setShowChoice(true)}>
              点我开始
            </button>
          </div>
        </section>
      ) : (
        <section className="home-choice relative z-[1] grid min-h-screen place-items-center px-5 py-28 sm:px-8">
          <div className="home-choice-inner">
            <p>选择要处理的法律文本任务</p>
            <div className="home-choice-grid">
              <button onClick={() => onNavigate('compare')}>
                <span>法规对比</span>
                <strong>两份文稿并排核对，自动对齐并标出差异。</strong>
              </button>
              <button onClick={() => onNavigate('interpret')}>
                <span>法规解读</span>
                <strong>单份法规生成结构化解读，校对后导出报告。</strong>
              </button>
            </div>
            <button className="home-choice-back" onClick={() => setShowChoice(false)}>返回</button>
          </div>
        </section>
      )}
      <footer className="hero-credit relative z-[1] mx-auto w-[min(760px,calc(100%-40px))] border-t border-black/10 px-4 py-7 text-center">
        <strong>Calvin</strong>
        <p>策划与设计 Claude · 工程实现 Codex · 出品 Calvin</p>
        <small>本工具由 AI 辅助生成，输出仅供参考，不构成法律意见；请以官方发布文本及人工核验为准。</small>
      </footer>
    </main>
  );
}
