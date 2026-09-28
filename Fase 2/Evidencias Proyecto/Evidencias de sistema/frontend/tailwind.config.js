/** @type {import('tailwindcss').Config} */

// Cada color apunta a una variable CSS (canales RGB) definida en src/index.css,
// así el modo claro/oscuro se resuelve solo cambiando las variables.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: token('canvas'),
        surface: token('surface'),
        subtle: token('subtle'),
        ink: token('ink'),
        muted: token('muted'),
        faint: token('faint'),
        line: token('line'),
        'line-strong': token('line-strong'),
        primary: token('primary'),
        'primary-ink': token('primary-ink'),
        brand: token('brand'),
        accent: token('accent'),
        'accent-soft': token('accent-soft'),
        success: token('success'),
        warning: token('warning'),
        danger: token('danger'),
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        xl: '14px',
        '2xl': '20px',
      },
      boxShadow: {
        soft: '0 1px 2px rgb(15 27 42 / 0.04), 0 4px 16px -4px rgb(15 27 42 / 0.06)',
        lift: '0 2px 4px rgb(15 27 42 / 0.04), 0 12px 32px -8px rgb(15 27 42 / 0.12)',
      },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.6s cubic-bezier(0.2, 0.6, 0.3, 1) infinite',
      },
    },
  },
  plugins: [],
}
