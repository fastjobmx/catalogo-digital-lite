/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)'],
        display: ['var(--font-display)'],
      },
      colors: {
        brand: {
          DEFAULT: 'var(--color-primary)',
          foreground: 'var(--color-primary-contrast)',
          secondary: 'var(--color-secondary)',
          'secondary-foreground': 'var(--color-secondary-contrast)',
          accent: 'var(--color-accent)',
          button: 'var(--color-button)',
        },
        canvas: 'var(--color-background)',
        surface: 'var(--color-surface)',
        ink: 'var(--color-text)',
        muted: 'var(--color-text-muted)',
        line: 'var(--color-border)',
        accent: 'var(--color-accent)',
      },
      borderRadius: {
        card: 'var(--radius-card)',
        btn: 'var(--radius-btn)',
        field: 'var(--radius-field)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
      },
      spacing: {
        section: 'var(--section-space)',
        grid: 'var(--grid-gap)',
        card: 'var(--card-pad)',
      },
      maxWidth: {
        shell: '80rem',
      },
      keyframes: {
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(24px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'slide-in-right': 'slide-in-right 260ms cubic-bezier(0.22, 1, 0.36, 1)',
        'slide-up': 'slide-up 500ms cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
}
