type BrandMarkProps = {
  size?: 'compact' | 'nav' | 'login';
  className?: string;
};

export function BrandMark({ size = 'nav', className = '' }: BrandMarkProps) {
  const iconClass =
    size === 'login'
      ? 'h-8 w-8 sm:h-9 sm:w-9'
      : size === 'compact'
        ? 'h-[22px] w-[22px]'
        : 'h-[26px] w-[26px] sm:h-[30px] sm:w-[30px]';
  const textClass = size === 'login' ? 'text-[30px] sm:text-[36px]' : size === 'compact' ? 'text-[20px]' : 'text-[26px] sm:text-[32px]';

  return (
    <span className={`inline-flex items-center gap-2 text-black sm:gap-3 ${className}`}>
      <svg className={iconClass} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M7.5 5h17A4.5 4.5 0 0 1 29 9.5v12A4.5 4.5 0 0 1 24.5 26H18v2.2h4.2a1.2 1.2 0 1 1 0 2.4H9.8a1.2 1.2 0 1 1 0-2.4H14V26H7.5A4.5 4.5 0 0 1 3 21.5v-12A4.5 4.5 0 0 1 7.5 5Zm.2 3A1.7 1.7 0 0 0 6 9.7v11.6A1.7 1.7 0 0 0 7.7 23h16.6a1.7 1.7 0 0 0 1.7-1.7V9.7A1.7 1.7 0 0 0 24.3 8H7.7Zm3.6 3.2h9.9a1.2 1.2 0 0 1 0 2.4h-9.9a1.2 1.2 0 0 1 0-2.4Zm0 5h6.4a1.2 1.2 0 1 1 0 2.4h-6.4a1.2 1.2 0 0 1 0-2.4Z"
        />
      </svg>
      <span className={`font-heading ${textClass} font-semibold tracking-normal`}>明文</span>
    </span>
  );
}
