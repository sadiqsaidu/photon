import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // legacy tokens (homepage)
        ink: { DEFAULT: "#070809", 900: "#070809", 800: "#0c0e12", 700: "#14171d", 600: "#1c212a" },
        accent: { DEFAULT: "#7fdfff", dim: "#3c6b7d" },
        fail: { DEFAULT: "#c2616b", dim: "#5a3338" },
        // signal-deck palette: near-black surfaces, crimson data, amber AI, green health
        coal: { DEFAULT: "#050505", panel: "#0a0a0a", raise: "#101010" },
        line: { DEFAULT: "#1c1c1c", bright: "#2a2a2a" },
        ember: { DEFAULT: "#e5484d", dim: "#8a2a2e", deep: "#2a0f11" },
        gilt: { DEFAULT: "#d9a53a", dim: "#7a5c1d", deep: "#241a08" },
        moss: { DEFAULT: "#46d16e", dim: "#1d5c35", deep: "#0a1f12" },
        bone: { DEFAULT: "#ececec", dim: "#8a8a8a", faint: "#565656", ghost: "#333333" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
