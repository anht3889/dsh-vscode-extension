import { defineConfig } from "vitest/config";

// The E2E test (`src/test/e2e.test.ts`) runs under the VS Code Extension Test
// host, not vitest; it value-imports `vscode` and must never be collected by
// vitest. Keep it out of the vitest scan while leaving the rest of the suite
// (src/**/*.test.ts and test/**/*.test.ts) untouched.
export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      ".vscode-test/**",
      "dist-test/**",
      "src/test/**",
    ],
  },
});
