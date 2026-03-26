import globals from "globals";
import { config as baseConfig } from "@repo/eslint-config/base";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      sourceType: "module",
    },
    ignores: [".*.js", "node_modules/", "dist/"],
  },
];
