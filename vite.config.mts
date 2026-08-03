import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { lingui, linguiTransformerBabelPreset } from "@lingui/vite-plugin";
import electron from "vite-electron-plugin";
import { customStart, loadViteEnv } from "vite-electron-plugin/plugin";
import pkg from "./package.json" with { type: "json" };

const UNKNOWN_COMMIT_SHA = "unknown";

function getCommitSha(): string {
  const configuredSha = process.env.VITE_COMMIT_SHA ?? process.env.GITHUB_SHA;
  if (configuredSha && /^[0-9a-f]{7,40}$/i.test(configuredSha)) {
    return configuredSha.slice(0, 7);
  }

  try {
    return (
      execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || UNKNOWN_COMMIT_SHA
    );
  } catch {
    return UNKNOWN_COMMIT_SHA;
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  rmSync("dist-electron", { recursive: true, force: true });

  const sourcemap = command === "serve" || !!process.env.VSCODE_DEBUG;

  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __APP_COMMIT_SHA__: JSON.stringify(getCommitSha()),
    },
    resolve: {
      alias: {
        "@": path.join(import.meta.dirname, "src"),
      },
    },
    plugins: [
      tailwindcss(),
      react(),
      lingui(),
      babel({
        presets: [linguiTransformerBabelPreset()],
      }),
      electron({
        include: ["electron"],
        transformOptions: {
          sourcemap,
        },
        plugins: [
          ...(!!process.env.VSCODE_DEBUG
            ? [
                // Will start Electron via VSCode Debug
                customStart(() =>
                  console.log(
                    /* For `.vscode/.debug.script.mjs` */ "[startup] Electron App"
                  )
                ),
              ]
            : []),
          // Allow use `import.meta.env.VITE_SOME_KEY` in Electron-Main
          loadViteEnv(),
          {
            name: "rewrite-electron-typescript-import-extensions",
            transform({ code }: { code: string }) {
              // Electron runs the emitted CommonJS files, so relative `.ts`
              // specifiers must point at their emitted `.js` counterparts.
              // Keeping `.ts` in source lets Node's strip-types test runner
              // execute the same modules without a separate transpiler.
              return code.replace(
                /(["'](?:\.\.?\/)[^"']+)\.ts(["'])/g,
                "$1.js$2"
              );
            },
          },
        ],
      }),
    ],
    server: !!process.env.VSCODE_DEBUG
      ? (() => {
          const url = new URL(pkg.debug.env.VITE_DEV_SERVER_URL);
          return {
            host: url.hostname,
            port: +url.port,
          };
        })()
      : undefined,
    clearScreen: false,
  };
});
