/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // VeriTrade's own brand — a trust-signalling deep blue, deliberately distinct
        // from Portal/App's safety orange (directive: "separate from ProjMan branding").
        brand: {
          50:  '#eff6ff',
          100: '#dbeafe',
          500: '#2563eb',
          600: '#1d4ed8',
          700: '#1e40af',
          900: '#1e3a8a',
        },
      },
      fontFamily: {
        sans:    ['var(--font-dm-sans)',   'sans-serif'],
        heading: ['var(--font-syne)',      'sans-serif'],
        mono:    ['var(--font-jetbrains)', 'monospace'],
      },
    },
  },
  plugins: [],
};
