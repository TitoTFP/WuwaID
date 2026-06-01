/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['"Source Serif Pro"', 'Georgia', 'serif'],
      },
      colors: {
        bg: {
          0: '#0b0d12',
          1: '#11141b',
          2: '#171b24',
          3: '#1f2530',
        },
        accent: {
          gold: '#d6b66b',
          teal: '#5ec5b6',
          ember: '#e0734a',
        },
      },
    },
  },
  plugins: [],
};
