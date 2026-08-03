/** @type {import('tailwindcss').Config} */
module.exports = {
  // These globs pointed at './index.html' and './src/**' — neither of which exists.
  // The app moved under shared/ and the content list never followed, so Tailwind was
  // scanning nothing and css/tailwind.css froze as a hand-maintained artifact. Any
  // class added after the move computed to nothing, silently: that is how bg-green-600
  // shipped on Install & Restart with no background. Keep these in sync with the file
  // list in tools/audit-design.js — the purge section fails the build if they drift.
  content: [
    './shared/frontend/index.html',
    './shared/frontend/wc-shell.js',
    './shared/frontend/premium/*.js',
    './shared/pill/pill.html',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: '#c07a4e',
        'accent-hover': '#b06b40',
        'accent-soft': '#cf9673',
        // Recovered from the frozen bundle, which had it and this config did not —
        // rebuilding without it would have silently dropped 12 live usages. Same
        // value as --wc-base in the dark theme; it predates the token and should
        // fold into it once the colour sweep reaches those call sites.
        'stone-850': '#1c1917',
      },
      fontFamily: {
        sans: ['Segoe UI', '-apple-system', 'system-ui', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['Cascadia Code', 'SF Mono', 'Fira Code', 'Consolas', 'monospace'],
        serif: ['Georgia', 'Times New Roman', 'serif'],
      },
      // Also recovered from the frozen bundle: 125ms is a real transition duration
      // used in markup, and duration-125 has been computing to nothing.
      transitionDuration: {
        125: '125ms',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-in': 'slideIn 0.3s ease-out forwards',
        'idle-pulse': 'audio-idle-pulse 2.1s ease-in-out infinite',
        'record-pulse': 'record-icon-pulse 1.7s ease-in-out infinite',
        'toast-in': 'toastIn 0.3s ease-out',
        'toast-out': 'toastOut 0.25s ease-in forwards',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'fade-slide-down': 'fadeSlideDown 0.15s ease-out',
        'banner-in': 'bannerIn 0.25s ease-out',
        'banner-out': 'bannerOut 0.2s ease-in forwards',
      },
      keyframes: {
        slideIn: {
          from: { opacity: '0', transform: 'translateX(100%)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'audio-idle-pulse': {
          '0%, 100%': { transform: 'scaleY(0.94)' },
          '50%': { transform: 'scaleY(1.18)' },
        },
        'record-icon-pulse': {
          '0%, 100%': { transform: 'scale(1)', boxShadow: '0 0 0 3px rgba(207, 150, 115, 0.2)' },
          '50%': { transform: 'scale(1.03)', boxShadow: '0 0 0 6px rgba(207, 150, 115, 0.15)' },
        },
        fadeSlideDown: {
          from: { opacity: '0', transform: 'translateY(-4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        toastIn: {
          from: { opacity: '0', transform: 'translateX(16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        toastOut: {
          from: { opacity: '1', transform: 'translateX(0)' },
          to: { opacity: '0', transform: 'translateX(16px)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideUp: {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        bannerIn: {
          from: { opacity: '0', transform: 'translateY(-100%)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        bannerOut: {
          from: { opacity: '1', transform: 'translateY(0)' },
          to: { opacity: '0', transform: 'translateY(-100%)' },
        },
      },
    },
  },
  plugins: [],
};
