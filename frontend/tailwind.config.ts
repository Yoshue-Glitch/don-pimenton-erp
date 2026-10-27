import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["'Inter Variable'", "Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
      colors: {
        paprika: { DEFAULT: "#A52A2A", 50: "#FBEDED", 100: "#F5D3D3", 600: "#A52A2A", 700: "#8A2222", 800: "#6E1B1B" },
        agro: { DEFAULT: "#285943", 50: "#E9F2EE", 100: "#CFE3DA", 600: "#285943", 700: "#1F4535" },
        cream: "#F8F5EE",
        ink: "#263238",
        gold: { DEFAULT: "#C8A46B", 50: "#F8F1E6" },
        bg: "rgb(var(--bg) / <alpha-value>)",
        card: "rgb(var(--card) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        soft: "rgb(var(--soft) / <alpha-value>)",
      },
      boxShadow: { card: "0 1px 2px rgba(38,50,56,.06), 0 1px 8px rgba(38,50,56,.04)" },
      keyframes: { in: { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } } },
      animation: { in: "in .18s ease-out" },
    },
  },
  plugins: [],
} satisfies Config;
