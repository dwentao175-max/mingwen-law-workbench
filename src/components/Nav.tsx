import type { ReactNode } from 'react';
import { BrandMark } from './BrandMark';

type NavProps = {
  accountControl: ReactNode;
};

export function Nav({ accountControl }: NavProps) {
  return (
    <nav className="fixed left-0 top-0 z-10 flex w-full items-center justify-between px-5 py-4 text-black sm:px-8 sm:py-5">
      <div className="border-0 bg-transparent p-0 text-black outline-none">
        <BrandMark />
      </div>
      {accountControl}
    </nav>
  );
}
