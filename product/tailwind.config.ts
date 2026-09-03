import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        orange: {
          DEFAULT: "#E8751A",
          50: "#FDF3EA",
          100: "#FBE4CE",
          200: "#F5C69B",
          300: "#F0A868",
          400: "#EC8C41",
          500: "#E8751A",
          600: "#C25E12",
          700: "#95480E",
          800: "#68320A",
          900: "#3B1C06",
        },
        navy: {
          DEFAULT: "#1A2B4C",
          50: "#EEF1F6",
          100: "#D3DAE7",
          200: "#A7B5CF",
          300: "#7B90B7",
          400: "#4F6B9F",
          500: "#324D7D",
          600: "#263C63",
          700: "#1A2B4C",
          800: "#131F38",
          900: "#0C1424",
        },
        success: {
          DEFAULT: "#2ECC71",
          light: "#D6F5E3",
        },
        warning: {
          DEFAULT: "#F1C40F",
          light: "#FDF3D0",
        },
        ink: "#2C3E50",
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      backgroundImage: {
        "grid-fade":
          "linear-gradient(180deg, rgba(26,43,76,0.96) 0%, rgba(26,43,76,0.88) 100%)",
      },
      boxShadow: {
        card: "0 1px 2px rgba(26,43,76,0.06), 0 8px 24px -8px rgba(26,43,76,0.12)",
        "card-hover":
          "0 4px 12px rgba(26,43,76,0.08), 0 16px 32px -12px rgba(232,117,26,0.2)",
      },
      maxWidth: {
        "8xl": "90rem",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(46,204,113,0.45)" },
          "100%": { boxShadow: "0 0 0 10px rgba(46,204,113,0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.6s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
