import tseslint from "typescript-eslint";
import unusedImports from "eslint-plugin-unused-imports";
import hooks from "eslint-plugin-react-hooks";
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      ".npm-cache/**",
      "assets/**",
      "images/**",
      "other pages 1/**",
      "Portfolio_Website/**",
      "cdn-cgi/**",
      "js/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: [
      "backend/**/*.ts",
      "frontend/src/**/*.{ts,tsx}",
      "frontend/vite.config.ts",
    ],
    plugins: { "unused-imports": unusedImports, "react-hooks": hooks },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    files: ["**/*.mjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
