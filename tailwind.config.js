/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: '#CF9673',
        'accent-hover': '#D4A484',
      },
      fontFamily: {
        sans: ['Segoe UI', '-apple-system', 'system-ui', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['Cascadia Code', 'SF Mono', 'Fira Code', 'Consolas', 'monospace'],
        serif: ['Georgia', 'Times New Roman', 'serif'],
      },
      animation: {
        'idle-pulse': 'audio-idle-pulse 2.1s ease-in-out infinite',
        'record-pulse': 'record-icon-pulse 1.7s ease-in-out infinite',
        'toast-in': 'toastIn 0.3s ease-out',
        'toast-out': 'toastOut 0.25s ease-in forwards',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'fade-slide-down': 'fadeSlideDown 0.15s ease-out',
      },
      keyframes: {
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
      },
    },
  },
  plugins: [],
};
