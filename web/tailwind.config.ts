import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#070809", 900: "#070809", 800: "#0c0e12", 700: "#14171d", 600: "#1c212a" },
        accent: { DEFAULT: "#7fdfff", dim: "#3c6b7d" },
        fail: { DEFAULT: "#c2616b", dim: "#5a3338" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
