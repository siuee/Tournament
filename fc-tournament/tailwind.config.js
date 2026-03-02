/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Bebas Neue', 'sans-serif'],
        headline: ['Anton', 'sans-serif'],
        sport: ['Oswald', 'sans-serif'],
        sans: ['Outfit', 'system-ui', 'sans-serif'],
      },
      colors: {
        dark: '#0f172a',
        darker: '#020617',
        neonBlue: '#3b82f6',
        neonGold: '#eab308',
      },
      backgroundImage: {
        'glass': 'linear-gradient(to bottom right, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.01))',
      }
    },
  },
  plugins: [],
}