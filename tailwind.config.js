/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)', surface: 'var(--surface)', sunk: 'var(--sunk)', line: 'var(--line)',
        ink: 'var(--ink)', muted: 'var(--muted)', faint: 'var(--faint)',
        accent: 'var(--accent)', 'accent-soft': 'var(--accent-soft)', 'accent-ink': 'var(--accent-ink)',
        brand: 'var(--brand)', 'brand-soft': 'var(--brand-soft)',
        ok: 'var(--ok)', 'ok-soft': 'var(--ok-soft)', warn: 'var(--warn)', 'warn-soft': 'var(--warn-soft)',
        bad: 'var(--bad)', 'bad-soft': 'var(--bad-soft)', info: 'var(--info)', 'info-soft': 'var(--info-soft)',
        violet: 'var(--violet)', 'violet-soft': 'var(--violet-soft)',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Figtree', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
