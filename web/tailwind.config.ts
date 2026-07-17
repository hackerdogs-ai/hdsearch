import type { Config } from 'tailwindcss';

// Hackerdogs brand tokens (placeholder — easy to rebrand later per spec §8).
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eefdf6',
          100: '#d6f9e8',
          200: '#aff1d3',
          300: '#79e4b8',
          400: '#3fce98',
          500: '#16b67e', // primary accent
          600: '#0a9466',
          700: '#0a7653',
          800: '#0c5d44',
          900: '#0b4d39',
        },
        ink: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d4d9e2',
          300: '#aeb6c7',
          400: '#828ea7',
          500: '#63708c',
          600: '#4d5872',
          700: '#3f485d',
          800: '#373e4f',
          900: '#0f1419', // near-black surface
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        caption: ['0.875rem', { lineHeight: '1.25rem' }],
        body: ['1rem', { lineHeight: '1.5rem' }],
        subhead: ['1.125rem', { lineHeight: '1.75rem' }],
        title: ['1.5rem', { lineHeight: '2rem' }],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.1)',
        pop: '0 10px 30px rgba(16,24,40,.12)',
      },
    },
  },
  plugins: [],
};
export default config;
