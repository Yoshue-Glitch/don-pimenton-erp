import type { Config } from "tailwindcss";

// Identidad visual Don Pimentón (paleta y tipografías del panel de Gerencia)
export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'DM Sans Variable'", "'DM Sans'", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Fraunces", "Georgia", "serif"],
      },
      colors: {
        forest: { DEFAULT: "#1C3F2B", 2: "#25513A", 3: "#2F6B45", deep: "#12291C" },
        paprika: { DEFAULT: "#A52A2A", 50: "#F7E4E1", 100: "#F2C9C0", 600: "#A52A2A", 700: "#8C2121", 800: "#6E1B1B" },
        agro: { DEFAULT: "#2F6B45", 50: "#E6EFE8", 100: "#CFE3DA", 600: "#2F6B45", 700: "#25513A" },
        amberx: { DEFAULT: "#B26B00", 50: "#FDF1D8" },
        bluex: { DEFAULT: "#2B6CB0", 50: "#E5EEF9" },
        cream: "#F8F5EF",
        beige: "#F3E9D8",
        ink: "#1F2937",
        gold: { DEFAULT: "#D9A441", 50: "#FBF2DF" },
        bg: "rgb(var(--bg) / <alpha-value>)",
        card: "rgb(var(--card) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        soft: "rgb(var(--soft) / <alpha-value>)",
      },
      boxShadow: { card: "0 10px 30px -18px rgba(28,63,43,.35)" },
      keyframes: { in: { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } } },
      animation: { in: "in .18s ease-out" },
    },
  },
  plugins: [],
} satisfies Config;
