/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // The whole app is themed by remapping the palettes the components
        // already use: slate -> warm charcoal, indigo -> brass, emerald -> felt.
        slate: {
          50: '#f8f3e9', 100: '#efe7d8', 200: '#dbcfb7', 300: '#bfb094',
          400: '#9d8e75', 500: '#7e715d', 600: '#5e5445', 700: '#413930',
          800: '#2b251e', 900: '#1e1914', 950: '#14110d',
        },
        indigo: {
          200: '#f2e2b0', 300: '#e8cd75', 400: '#dbb84c',
          500: '#c9a227', 600: '#a9861a', 700: '#816513', 800: '#5c480e',
        },
        blue: {
          300: '#e8cd75', 400: '#dbb84c', 500: '#c9a227', 600: '#a9861a',
        },
        emerald: {
          300: '#93cfa2', 400: '#6cae7d', 500: '#4c9160', 600: '#3b7a4d',
          900: '#1d3a2a',
        },
        red: {
          300: '#e09a92', 400: '#d4756a', 500: '#b8493d', 600: '#9a382e',
        },
        board: {
          light: '#f0d9b5',
          dark: '#b58863',
          highlight: '#f6d96b',
          selected: '#9a8b4f',
        },
        brass: {
          DEFAULT: '#c9a227',
          soft: '#e8cd75',
          dim: 'rgba(201, 162, 39, 0.18)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Playfair Display"', 'Georgia', 'serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        pulse2: 'pulse2 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        pulse2: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },
    },
  },
  plugins: [],
};
