import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      borderRadius: {
        full: '9999px'
      },
      fontSize: {
        'hero-copy': 'clamp(18px,4vw,26px)',
        'hero-label': 'clamp(18px,4vw,26px)'
      },
      transitionDuration: {
        400: '400ms',
        ui: '300ms'
      },
      transitionTimingFunction: {
        ui: 'cubic-bezier(0.22, 1, 0.36, 1)'
      },
      fontFamily: {
        heading: ['var(--font-heading)'],
        body: ['var(--font-body)']
      }
    }
  },
  plugins: []
} satisfies Config;
