import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import swc from "unplugin-swc";

export default defineConfig({
  // vitest 4 транспилирует через oxc по умолчанию; отключаем — декораторы обязаны идти через SWC
  oxc: false,
  plugins: [
    // ВАЖНО: esbuild (дефолт vitest) не эмитит design:type — только SWC/tsc.
    swc.vite({
      jsc: {
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: "es2020",
      },
    }),
  ],
  resolve: {
    alias: {
      "@aom-js/core": resolve(__dirname, "packages/core/src"),
      "@aom-js/schemer": resolve(__dirname, "packages/schemer/src"),
      "@aom-js/router": resolve(__dirname, "packages/router/src"),
      "@aom-js/transfer": resolve(__dirname, "packages/transfer/src"),
      "@aom-js/holder": resolve(__dirname, "packages/holder/src"),
    },
  },
  test: {
    environment: "node",
    include: ["packages/*/test/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
    },
  },
});
