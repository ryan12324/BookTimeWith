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
        faint: "#71695d", // tertiary text, 4.6:1+ on every light app surface
        bronze: "#776a50", // accent: 4.5:1+ on light surfaces and behind paper text
        "bronze-hover": "#695a41", // bronze button hover
        "bronze-ink": "#5f513b", // high-contrast accent text and links
        "bronze-light": "#c5b894", // warm accent on ink surfaces
        "paper-muted": "#c7bfb2", // secondary copy on ink surfaces
        line: "#8f8677", // 3:1+ control boundaries on app surfaces
        "line-soft": "#e6dfd3", // card borders
        hairline: "#efe9de", // hairline dividers
        disabled: "#d6cdbc", // disabled CTA background
        "toggle-off": "#8f8677", // 3:1+ off-state track on light surfaces
      },
      fontFamily: {
        // Names with digits must be quoted in the emitted CSS or the whole
        // font-family declaration is invalid (bare `3`/`4` isn't an identifier).
        serif: ["var(--font-serif)", "'Source Serif 4'", "Georgia", "serif"],
        sans: ["var(--font-sans)", "'Libre Franklin'", "system-ui", "sans-serif"],
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
