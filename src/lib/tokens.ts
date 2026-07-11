/**
 * Design token hex values, mirrored here for the places that need color in JS
 * (canvas-like grid painting, inline SVG). Keep in sync with tailwind.config.ts.
 */
export const T = {
  paper: "#faf8f4",
  paperDim: "#f0ede6",
  tint: "#f3efe7",
  tintWarm: "#f7f3ea",
  ink: "#26221c",
  inkSoft: "#3d372e",
  body: "#6b6357",
  faint: "#71695d",
  bronze: "#776a50",
  bronzeHover: "#695a41",
  line: "#8f8677",
  lineSoft: "#e6dfd3",
  hairline: "#efe9de",
  disabled: "#d6cdbc",
  toggleOff: "#8f8677",
} as const;
