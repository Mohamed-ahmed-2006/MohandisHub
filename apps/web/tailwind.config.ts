import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        muted: 'hsl(var(--muted))',
        accent: 'hsl(var(--accent))',
        card: 'hsl(var(--card))',
        border: 'hsl(var(--border))',
      },
      fontFamily: {
        sans: ['var(--font-manrope)', 'sans-serif'],
        display: ['var(--font-sora)', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 14px 45px -25px rgba(0, 0, 0, 0.25)',
      },
    },
  },
  plugins: [],
};

export default config;
