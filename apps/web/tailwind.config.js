/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // SeaBridge Brand Colors
        navy: {
          50: '#f0f4f8',
          100: '#d9e2ec',
          200: '#bcccdc',
          300: '#9fb3c8',
          400: '#829ab1',
          500: '#627d98',
          600: '#486581',
          700: '#334e68',
          800: '#243b53',
          900: '#1e3a5f', // Primary Navy
          950: '#102a43',
        },
        gold: {
          50: '#fdf9ed',
          100: '#f9f0d1',
          200: '#f3dfa0',
          300: '#ecc96a',
          400: '#e5b43d',
          500: '#c9a227', // Primary Gold
          600: '#b18a1f',
          700: '#8f6b1c',
          800: '#76551e',
          900: '#63471e',
          950: '#38250e',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
