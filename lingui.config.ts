import { defineConfig } from "@lingui/cli";

export default defineConfig({
  sourceLocale: "en-US",
  locales: ["en-US", "zh-TW", "zh-CN"],
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}",
      include: ["<rootDir>/src"],
    },
  ],
});
