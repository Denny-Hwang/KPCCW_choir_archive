/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1c1917',
        paper: '#faf9f7',
      },
    },
  },
  plugins: [],
}
