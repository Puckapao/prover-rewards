/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  plugins: [],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        dashDark: '#181A20',
        dashCard: '#22242B',
        dashAccent: '#4285F4',
        dashAccent2: '#7F56D9',
      }
    }
  }
}
