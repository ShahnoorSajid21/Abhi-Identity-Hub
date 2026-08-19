/**
 * Tailwind mirrors the tokens in src/styles/tokens.css. Tokens are the source
 * of truth; this file only exposes them to utility classes. Do not add a hex
 * here that does not exist there.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          900: 'var(--abhi-navy-900)',
          800: 'var(--abhi-navy-800)',
          700: 'var(--abhi-navy-700)',
          600: 'var(--abhi-navy-600)',
          500: 'var(--abhi-navy-500)',
        },
        mint: {
          600: 'var(--abhi-mint-600)',
          500: 'var(--abhi-mint-500)',
          300: 'var(--abhi-mint-300)',
          100: 'var(--abhi-mint-100)',
        },
        ink: {
          900: 'var(--slate-900)',
          700: 'var(--slate-700)',
          500: 'var(--slate-500)',
          300: 'var(--slate-300)',
          200: 'var(--slate-200)',
          100: 'var(--slate-100)',
          50: 'var(--slate-50)',
        },
        ok: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)', line: 'var(--ok-line)' },
        warn: { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)', line: 'var(--warn-line)' },
        stop: { bg: 'var(--stop-bg)', fg: 'var(--stop-fg)', line: 'var(--stop-line)' },
        new: { bg: 'var(--new-bg)', fg: 'var(--new-fg)', line: 'var(--new-line)' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'Consolas', 'monospace'],
      },
      fontSize: {
        // Projector-calibrated. Body is 15px, not 14px. Nothing below 12px.
        caption: ['12px', { lineHeight: '16px', letterSpacing: '0.04em' }],
        cell: ['14px', { lineHeight: '20px' }],
        body: ['15px', { lineHeight: '24px' }],
        section: ['16px', { lineHeight: '24px' }],
        title: ['24px', { lineHeight: '32px' }],
        metric: ['36px', { lineHeight: '40px' }],
      },
      spacing: {
        1: 'var(--space-1)',
        2: 'var(--space-2)',
        3: 'var(--space-3)',
        4: 'var(--space-4)',
        6: 'var(--space-6)',
        8: 'var(--space-8)',
        12: 'var(--space-12)',
        sidebar: '240px',
        topbar: '56px',
      },
      borderRadius: {
        control: 'var(--radius-control)',
        card: 'var(--radius-card)',
        pill: 'var(--radius-pill)',
      },
      maxWidth: {
        content: '1280px',
      },
      transitionDuration: {
        fast: 'var(--motion-fast)',
        panel: 'var(--motion-panel)',
        deliberate: 'var(--motion-deliberate)',
      },
    },
  },
  plugins: [],
};
