import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/**", ".wrangler/**", "node_modules/**", "**/*.d.ts", "playwright-report/**", "test-results/**"] },
  js.configs.recommended,
  {
    // Node build scripts (prerender, tooling): Node/DOM globals are provided by
    // the runtime, and the core no-undef rule has no environment awareness here.
    files: ["scripts/**/*.{js,mjs}", "*.config.js"],
    rules: { "no-undef": "off" },
  },
  {
    // Hand-written static scripts served as-is (GA bootstrap, service worker):
    // browser/service-worker globals are provided by the runtime, not lint.
    files: ["public/**/*.js"],
    rules: { "no-undef": "off" },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "react-hooks": reactHooks,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      // TypeScript performs its own undefined-identifier checking; the core rule
      // produces false positives for DOM/Worker/Node globals under a single config.
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      ...reactHooks.configs.recommended.rules,
    },
  },
];
