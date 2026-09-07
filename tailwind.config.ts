import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#EEF0F3",
        panel: "#FFFFFF",
        ink: "#1B2027",
        graphite: "#4A5262",
        line: "#D7DBE2",
        amber: {
          DEFAULT: "#E29A3C",
          dark: "#B9761F",
          light: "#F6E4C6",
        },
        rack: "#2F5D62",
        alert: "#B5453D",
        go: "#3E7A56",
      },
      fontFamily: {
        display: ["var(--font-display)"],
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        sm: "2px",
        DEFAULT: "3px",
        md: "4px",
      },
    },
  },
  plugins: [],
};
export default config;
