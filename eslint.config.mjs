import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist/**", "node_modules/**", "outputs/**", "tmp/**", ".venv*/**", ".next/**", ".vinext/**", ".wrangler/**"]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.flat.recommended.rules,
  },
  {
    files: ["lib/**/*.mjs", "scripts/**/*.mjs", "tests/**/*.mjs", "research/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
]);
