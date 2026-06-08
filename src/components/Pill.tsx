import type { ButtonHTMLAttributes, ReactNode } from 'react';

type PillProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'solid' | 'outline';
  children: ReactNode;
};

export function Pill({ variant = 'solid', className = '', children, ...props }: PillProps) {
  const variantClass =
    variant === 'solid'
      ? 'bg-white text-black border-black/10 hover:bg-black hover:text-white'
      : 'bg-transparent text-black border-black hover:bg-black hover:text-white';
  return (
    <button
      className={`inline-flex items-center justify-center rounded-full border px-4 py-[0.3em] mx-[0.2em] mb-[0.4em] text-[13px] sm:px-5 sm:text-[15px] whitespace-nowrap transition-colors duration-200 ${variantClass} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
