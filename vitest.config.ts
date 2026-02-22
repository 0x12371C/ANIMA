import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@veil/vm-sdk": fileURLToPath(new URL("./sdks/veil-vm/src/index.ts", import.meta.url)),
      "@veil/zeroid": fileURLToPath(new URL("./sdks/zeroid/src/index.ts", import.meta.url)),
    },
  },
  test: {
    testTimeout: 30_000,
    include: [
      "src/__tests__/**/*.test.ts",
      "sdks/*/test/**/*.test.ts",
      "test/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/__tests__/**",
        "src/types.ts",
        "node_modules/**",
      ],
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 55,
        lines: 60,
      },
      reporter: ["text", "text-summary", "json-summary"],
    },
  },
});
