import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: here });

const config = [
  {
    ignores: [
      ".next/**",
      ".data/**",
      "node_modules/**",
      "project/**",
      "drizzle/**",
      "public/**",
      "chats/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // This is an App Router root layout; the legacy pages/_document warning is
    // not applicable to its document-wide font links.
    rules: { "@next/next/no-page-custom-font": "off" },
  },
];

export default config;
