import { defineConfig } from "vitest/config";

export default defineConfig({
  // The workspace packages (`@workspace/*`) export their TypeScript source
  // directly and rely on the custom `workspace` export condition (see
  // tsconfig.base.json). Mirror that here so tests can import them the same
  // way the application code does.
  resolve: {
    conditions: ["workspace"],
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
  },
});
