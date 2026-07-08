import type { Config } from "tailwindcss";

/**
 * Design tokens from the Book Time With handoff spec (README "Design tokens").
 * Colors are literal hex values so the whole app reads as one warm-paper system.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#faf8f4", // page / app background
        "paper-dim": "#f0ede6", // app canvas background
        tint: "#f3efe7", // selected-day bg
        "tint-warm": "#f7f3ea", // hover / selected-option bg
        ink: "#26221c", // text, primary buttons, selected slots
        "ink-soft": "#3d372e", // primary button hover; dark-section hairlines
        body: "#6b6357", // secondary text
        faint: "#a89f90", // tertiary text, placeholders
        bronze: "#8a7a5c", // accent: confirm CTAs, painted cells, badges, links
        "bronze-hover": "#776a50", // bronze button hover
        "bronze-ink": "#6b5d45", // bronze text hover (bookings "Move")
        line: "#ddd5c8", // input / card borders
        "line-soft": "#e6dfd3", // card borders
        hairline: "#efe9de", // hairline dividers
        disabled: "#d6cdbc", // disabled CTA bg, toggle-off track
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Source Serif 4", "Georgia", "serif"],
        sans: ["var(--font-sans)", "Libre Franklin", "system-ui", "sans-serif"],
      },
      borderRadius: {
        input: "6px",
        chip: "7px",
        card: "10px",
        "card-lg": "12px",
        cell: "4px",
      },
      boxShadow: {
        card: "0 12px 32px rgba(38,34,28,.06)",
        "card-sm": "0 2px 8px rgba(38,34,28,.05)",
        float: "0 16px 44px rgba(38,34,28,.09)",
      },
      letterSpacing: {
        label: "0.06em",
        wide: "0.08em",
        wider: "0.1em",
      },
    },
  },
  plugins: [],
};

export default config;
